package com.pagio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.tom_roush.pdfbox.pdmodel.PDResources
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import java.io.File
import java.io.FileOutputStream

enum class ImageFormat(val ext: String, val compress: Bitmap.CompressFormat) {
    JPG("jpg", Bitmap.CompressFormat.JPEG), PNG("png", Bitmap.CompressFormat.PNG)
}

/**
 * Rendu des pages avec le moteur PDF intégré à Android (PdfRenderer) : miniatures,
 * aperçus et conversion PDF → images. Les fichiers chiffrés doivent être déverrouillés avant.
 */
object PdfRender {

    /** Taille affichée (en points) de chaque page. */
    fun pageSizes(file: File): List<Pair<Int, Int>> = open(file) { r ->
        (0 until r.pageCount).map { i -> r.openPage(i).usePage { it.width to it.height } }
    }

    fun pageCount(file: File): Int = open(file) { it.pageCount }

    /** Rend une page à la largeur demandée en pixels. */
    fun renderPage(file: File, index: Int, targetWidthPx: Int): Bitmap = open(file) { r ->
        r.openPage(index).usePage { page -> render(page, targetWidthPx.toFloat() / page.width) }
    }

    fun render(page: PdfRenderer.Page, scale: Float): Bitmap {
        val w = (page.width * scale).toInt().coerceIn(1, 6000)
        val h = (page.height * scale).toInt().coerceIn(1, 6000)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(bmp).drawColor(Color.WHITE)
        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
        return bmp
    }

    /** PDF → une image par page (JPG ou PNG) à la résolution choisie. */
    fun toImages(
        file: File, outDir: File, format: ImageFormat, dpi: Int, pages: List<Int>? = null,
        quality: Int = 90, ctx: TaskContext = TaskContext.NONE,
    ): List<File> = open(file) { r ->
        val list = pages ?: (1..r.pageCount).toList()
        list.mapIndexed { i, p ->
            ctx.progress(i.toFloat() / list.size, "Page $p")
            r.openPage(p - 1).usePage { page ->
                val bmp = render(page, dpi / 72f)
                val out = outputFile(outDir, "${file.baseName()}_page$p", format.ext)
                FileOutputStream(out).use { bmp.compress(format.compress, quality, it) }
                bmp.recycle()
                out
            }
        }
    }

    /** Extrait les images intégrées au PDF, dans leur résolution d'origine. */
    fun extractImages(file: File, outDir: File, format: ImageFormat, password: String? = null, ctx: TaskContext = TaskContext.NONE): List<File> =
        file.usePdf(password) { doc ->
            val out = mutableListOf<File>()
            val seen = HashSet<Any>()
            doc.pages.forEachIndexed { i, page ->
                ctx.progress(i.toFloat() / doc.numberOfPages)
                page.resources?.let { collect(it, seen, 0) { img ->
                    val bmp = runCatching { img.image }.getOrNull() ?: return@collect
                    if (bmp.width < 16 || bmp.height < 16) return@collect
                    val f = outputFile(outDir, "${file.baseName()}_p${i + 1}_img${out.size + 1}", format.ext)
                    FileOutputStream(f).use { bmp.compress(format.compress, 92, it) }
                    out += f
                } }
            }
            if (out.isEmpty()) throw EngineException(EngineError.EMPTY_INPUT, "Ce PDF ne contient aucune image intégrée")
            out
        }

    private fun collect(res: PDResources, seen: HashSet<Any>, depth: Int, onImage: (PDImageXObject) -> Unit) {
        if (depth > 6) return
        for (name in res.xObjectNames) {
            val xo = runCatching { res.getXObject(name) }.getOrNull() ?: continue
            if (!seen.add(xo.cosObject)) continue
            when (xo) {
                is PDImageXObject -> onImage(xo)
                is PDFormXObject -> xo.resources?.let { collect(it, seen, depth + 1, onImage) }
            }
        }
    }

    inline fun <T> open(file: File, block: (PdfRenderer) -> T): T {
        val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        val renderer = try { PdfRenderer(pfd) } catch (e: SecurityException) {
            pfd.close(); throw EngineException(EngineError.PASSWORD_REQUIRED, "Document protégé : déverrouillez-le d'abord", e)
        } catch (e: Exception) {
            pfd.close(); throw EngineException(EngineError.CORRUPTED, "Aperçu impossible : fichier PDF endommagé", e)
        }
        return renderer.use(block)
    }
}

internal inline fun <T> PdfRenderer.Page.usePage(block: (PdfRenderer.Page) -> T): T = try { block(this) } finally { close() }
