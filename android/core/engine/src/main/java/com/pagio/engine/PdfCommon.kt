package com.pagio.engine

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.pdmodel.font.PDFont
import com.tom_roush.pdfbox.pdmodel.font.PDType0Font
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.util.Matrix
import java.io.File
import java.io.IOException

/** Initialisation unique du moteur (polices standard, glyphes). */
object PagioEngine {
    @Volatile private var ready = false

    fun init(context: Context) {
        if (ready) return
        synchronized(this) {
            if (!ready) {
                PDFBoxResourceLoader.init(context.applicationContext)
                ready = true
            }
        }
    }

    /**
     * Les gros documents sont lus via un fichier temporaire au lieu de la mémoire,
     * ce qui évite les plantages (OutOfMemory) sur les PDF volumineux.
     */
    internal fun memory(): MemoryUsageSetting = MemoryUsageSetting.setupMixed(32L * 1024 * 1024)
}

/** Ouvre un PDF en traduisant les erreurs en codes compréhensibles. */
fun openPdf(file: File, password: String? = null): PDDocument {
    if (!file.exists() || file.length() == 0L) {
        throw EngineException(EngineError.EMPTY_INPUT, "Fichier vide ou introuvable : ${file.name}")
    }
    try {
        return if (password.isNullOrEmpty()) PDDocument.load(file, PagioEngine.memory())
        else PDDocument.load(file, password, PagioEngine.memory())
    } catch (e: InvalidPasswordException) {
        throw if (password.isNullOrEmpty())
            EngineException(EngineError.PASSWORD_REQUIRED, "« ${file.name} » est protégé par un mot de passe", e)
        else EngineException(EngineError.WRONG_PASSWORD, "Mot de passe incorrect pour « ${file.name} »", e)
    } catch (e: IOException) {
        throw EngineException(EngineError.CORRUPTED, "Impossible de lire « ${file.name} » : fichier endommagé ou non PDF", e)
    }
}

inline fun <T> File.usePdf(password: String? = null, block: (PDDocument) -> T): T =
    openPdf(this, password).use(block)

/** Nom de sortie lisible et unique dans [dir]. */
fun outputFile(dir: File, baseName: String, extension: String): File {
    dir.mkdirs()
    val clean = baseName.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(80).ifBlank { "document" }
    var f = File(dir, "$clean.$extension")
    var i = 2
    while (f.exists()) { f = File(dir, "$clean ($i).$extension"); i++ }
    return f
}

fun File.baseName(): String = nameWithoutExtension

/**
 * Repère « affiché » d'une page : origine en bas à gauche de la page telle qu'on la voit
 * (rotation /Rotate appliquée). Permet de placer textes et images droits quelle que soit la rotation.
 */
class PageSpace(page: PDPage) {
    private val box = page.cropBox
    private val rotation = ((page.rotation % 360) + 360) % 360
    private val w = box.width
    private val h = box.height
    private val llx = box.lowerLeftX
    private val lly = box.lowerLeftY

    val width: Float = if (rotation == 90 || rotation == 270) h else w
    val height: Float = if (rotation == 90 || rotation == 270) w else h

    /** Matrice affichage → espace utilisateur PDF. */
    val matrix: Matrix = when (rotation) {
        90 -> Matrix(0f, 1f, -1f, 0f, w + llx, lly)
        180 -> Matrix(-1f, 0f, 0f, -1f, w + llx, h + lly)
        270 -> Matrix(0f, -1f, 1f, 0f, llx, h + lly)
        else -> Matrix(1f, 0f, 0f, 1f, llx, lly)
    }

    /** Convertit un point affiché (origine en bas à gauche) en coordonnées PDF. */
    fun toUser(x: Float, y: Float): Pair<Float, Float> {
        val p = matrix.transformPoint(x, y)
        return p.x to p.y
    }

    /** Convertit un point normalisé (0..1, origine en haut à gauche, comme à l'écran). */
    fun fromNormalized(nx: Float, ny: Float): Pair<Float, Float> = nx * width to (1f - ny) * height
}

/** Ouvre un flux de dessin en mode ajout, déjà placé dans le repère affiché de la page. */
inline fun PDDocument.drawOnPage(page: PDPage, block: (PDPageContentStream, PageSpace) -> Unit) {
    val space = PageSpace(page)
    PDPageContentStream(this, page, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
        cs.saveGraphicsState()
        cs.transform(space.matrix)
        block(cs, space)
        cs.restoreGraphicsState()
    }
}

/** Choix de police : Helvetica standard si possible, sinon une police système Unicode intégrée. */
class FontKit(private val doc: PDDocument) {
    private var unicode: PDFont? = null
    private var unicodeTried = false

    fun font(text: String, bold: Boolean = false, italic: Boolean = false, family: String = "sans"): PDFont {
        val std = when (family) {
            "serif" -> when { bold && italic -> PDType1Font.TIMES_BOLD_ITALIC; bold -> PDType1Font.TIMES_BOLD; italic -> PDType1Font.TIMES_ITALIC; else -> PDType1Font.TIMES_ROMAN }
            "mono" -> when { bold && italic -> PDType1Font.COURIER_BOLD_OBLIQUE; bold -> PDType1Font.COURIER_BOLD; italic -> PDType1Font.COURIER_OBLIQUE; else -> PDType1Font.COURIER }
            else -> when { bold && italic -> PDType1Font.HELVETICA_BOLD_OBLIQUE; bold -> PDType1Font.HELVETICA_BOLD; italic -> PDType1Font.HELVETICA_OBLIQUE; else -> PDType1Font.HELVETICA }
        }
        if (canEncode(std, text)) return std
        return unicodeFont() ?: std
    }

    /** Remplace les caractères non représentables par « ? » pour ne jamais échouer. */
    fun safeText(font: PDFont, text: String): String {
        if (canEncode(font, text)) return text
        val sb = StringBuilder()
        for (ch in text) sb.append(if (canEncode(font, ch.toString())) ch else '?')
        return sb.toString()
    }

    private fun unicodeFont(): PDFont? {
        if (unicodeTried) return unicode
        unicodeTried = true
        val candidates = listOf(
            "/system/fonts/NotoSans-Regular.ttf", "/system/fonts/DroidSans.ttf",
            "/system/fonts/Roboto-Regular.ttf", "/system/fonts/NotoSansCJK-Regular.ttc"
        )
        for (path in candidates) {
            val f = File(path)
            if (!f.exists() || path.endsWith(".ttc")) continue
            unicode = runCatching { PDType0Font.load(doc, f) }.getOrNull()
            if (unicode != null) break
        }
        return unicode
    }

    companion object {
        fun canEncode(font: PDFont, text: String): Boolean =
            runCatching { font.encode(text.replace("\n", "").replace("\t", " ")); true }.getOrDefault(false)

        fun width(font: PDFont, text: String, size: Float): Float =
            runCatching { font.getStringWidth(text) / 1000f * size }.getOrDefault(text.length * size * 0.5f)
    }
}

/** Découpe un texte en lignes qui tiennent dans [maxWidth]. */
fun wrapText(font: PDFont, text: String, size: Float, maxWidth: Float): List<String> {
    val lines = mutableListOf<String>()
    for (paragraph in text.replace("\r\n", "\n").replace('\t', ' ').split('\n')) {
        if (paragraph.isBlank()) { lines += ""; continue }
        var current = StringBuilder()
        for (word in paragraph.split(' ')) {
            val candidate = if (current.isEmpty()) word else "$current $word"
            if (FontKit.width(font, candidate, size) <= maxWidth) {
                current = StringBuilder(candidate)
            } else {
                if (current.isNotEmpty()) lines += current.toString()
                // Mot plus long que la ligne : on le coupe.
                var w = word
                while (FontKit.width(font, w, size) > maxWidth && w.length > 1) {
                    var cut = w.length - 1
                    while (cut > 1 && FontKit.width(font, w.substring(0, cut), size) > maxWidth) cut--
                    lines += w.substring(0, cut)
                    w = w.substring(cut)
                }
                current = StringBuilder(w)
            }
        }
        lines += current.toString()
    }
    return lines
}

/** Couleur au format #RRGGBB → composantes 0..1. */
fun parseColor(hex: String): FloatArray {
    val h = hex.removePrefix("#")
    val v = h.toLongOrNull(16) ?: 0L
    return floatArrayOf(((v shr 16) and 0xFF) / 255f, ((v shr 8) and 0xFF) / 255f, (v and 0xFF) / 255f)
}
