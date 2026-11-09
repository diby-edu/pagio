package com.pagio.engine

import android.graphics.BitmapFactory
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState
import com.tom_roush.pdfbox.util.Matrix
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Position sur une grille 3×3. */
enum class Anchor(val h: Int, val v: Int) {
    TOP_LEFT(0, 2), TOP_CENTER(1, 2), TOP_RIGHT(2, 2),
    MIDDLE_LEFT(0, 1), CENTER(1, 1), MIDDLE_RIGHT(2, 1),
    BOTTOM_LEFT(0, 0), BOTTOM_CENTER(1, 0), BOTTOM_RIGHT(2, 0);
}

data class PageNumberOptions(
    val anchor: Anchor = Anchor.BOTTOM_CENTER,
    val format: String = "{n}",           // {n} = numéro, {p} = total. Ex. « Page {n} sur {p} »
    val firstNumber: Int = 1,
    val pages: String = "",               // intervalle ; vide = toutes
    val fontSize: Float = 11f,
    val colorHex: String = "#333333",
    val marginPt: Float = 28f,
    val facingPages: Boolean = false,     // pages en vis-à-vis : gauche/droite alternés
    val bold: Boolean = false,
)

data class WatermarkOptions(
    val text: String? = "CONFIDENTIEL",
    val imageFile: File? = null,
    val anchor: Anchor = Anchor.CENTER,
    val mosaic: Boolean = false,
    val opacity: Float = 0.3f,
    val rotationDeg: Float = 45f,
    val fontSize: Float = 48f,
    val colorHex: String = "#D32F2F",
    val imageScale: Float = 0.4f,        // largeur de l'image en fraction de la page
    val pages: String = "",
    val behindContent: Boolean = false,  // « couche » : sous le contenu
    val bold: Boolean = true,
)

data class HeaderFooterOptions(
    val headerLeft: String = "", val headerCenter: String = "", val headerRight: String = "",
    val footerLeft: String = "", val footerCenter: String = "", val footerRight: String = "",
    val fontSize: Float = 9f,
    val colorHex: String = "#444444",
    val marginPt: Float = 24f,
    val pages: String = "",
    val fileName: String = "",
)

/** Tampons : numéros de page, filigranes, en-têtes et pieds de page. */
object PdfStamps {

    fun pageNumbers(input: File, opt: PageNumberOptions, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): File =
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val total = doc.numberOfPages
            val targets = PageRanges.pages(opt.pages, total).toSet()
            val fonts = FontKit(doc)
            val color = parseColor(opt.colorHex)
            var counter = opt.firstNumber
            val lastNumber = opt.firstNumber + targets.size - 1
            doc.pages.forEachIndexed { i, page ->
                ctx.progress(i.toFloat() / total)
                if ((i + 1) !in targets) return@forEachIndexed
                val label = opt.format.replace("{n}", counter.toString()).replace("{p}", lastNumber.toString())
                counter++
                val anchor = if (opt.facingPages && (i % 2 == 1)) mirror(opt.anchor) else opt.anchor
                doc.drawOnPage(page) { cs, space ->
                    val font = fonts.font(label, bold = opt.bold)
                    val text = fonts.safeText(font, label)
                    val w = FontKit.width(font, text, opt.fontSize)
                    val (x, y) = place(anchor, space.width, space.height, w, opt.fontSize, opt.marginPt)
                    cs.beginText()
                    cs.setFont(font, opt.fontSize)
                    cs.setNonStrokingColor(color[0], color[1], color[2])
                    cs.newLineAtOffset(x, y)
                    cs.showText(text)
                    cs.endText()
                }
            }
            doc.save(output); output
        }

    fun watermark(input: File, opt: WatermarkOptions, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): File =
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            if (opt.text.isNullOrBlank() && opt.imageFile == null) {
                throw EngineException(EngineError.EMPTY_INPUT, "Saisissez un texte ou choisissez une image de filigrane")
            }
            val total = doc.numberOfPages
            val targets = PageRanges.pages(opt.pages, total).toSet()
            val fonts = FontKit(doc)
            val color = parseColor(opt.colorHex)
            val image: PDImageXObject? = opt.imageFile?.let { f ->
                val bmp = BitmapFactory.decodeFile(f.absolutePath)
                    ?: throw EngineException(EngineError.UNSUPPORTED_FORMAT, "Image de filigrane illisible")
                LosslessFactory.createFromImage(doc, bmp)
            }
            val gs = PDExtendedGraphicsState().apply {
                nonStrokingAlphaConstant = opt.opacity.coerceIn(0.05f, 1f)
                strokingAlphaConstant = opt.opacity.coerceIn(0.05f, 1f)
            }
            doc.pages.forEachIndexed { i, page ->
                ctx.progress(i.toFloat() / total)
                if ((i + 1) !in targets) return@forEachIndexed
                val space = PageSpace(page)
                val mode = if (opt.behindContent) PDPageContentStream.AppendMode.PREPEND else PDPageContentStream.AppendMode.APPEND
                PDPageContentStream(doc, page, mode, true, true).use { cs ->
                    cs.saveGraphicsState()
                    cs.transform(space.matrix)
                    cs.setGraphicsStateParameters(gs)
                    val positions = if (opt.mosaic) mosaicPositions(space.width, space.height)
                    else listOf(anchorPoint(opt.anchor, space.width, space.height))
                    for ((cx, cy) in positions) {
                        if (image != null) {
                            val w = space.width * opt.imageScale * (if (opt.mosaic) 0.5f else 1f)
                            val h = w * image.height / image.width
                            val m = Matrix.getRotateInstance(Math.toRadians(opt.rotationDeg.toDouble()), cx, cy)
                            m.concatenate(Matrix.getTranslateInstance(-w / 2, -h / 2))
                            m.concatenate(Matrix.getScaleInstance(w, h))
                            cs.drawImage(image, m)
                        }
                        val txt = opt.text
                        if (!txt.isNullOrBlank()) {
                            val size = if (opt.mosaic) opt.fontSize * 0.6f else opt.fontSize
                            val font = fonts.font(txt, bold = opt.bold)
                            val safe = fonts.safeText(font, txt)
                            val w = FontKit.width(font, safe, size)
                            cs.beginText()
                            cs.setFont(font, size)
                            cs.setNonStrokingColor(color[0], color[1], color[2])
                            val m = Matrix.getRotateInstance(Math.toRadians(opt.rotationDeg.toDouble()), cx, cy)
                            m.concatenate(Matrix.getTranslateInstance(-w / 2, -size / 3))
                            cs.setTextMatrix(m)
                            cs.showText(safe)
                            cs.endText()
                        }
                    }
                    cs.restoreGraphicsState()
                }
            }
            doc.save(output); output
        }

    fun headerFooter(input: File, opt: HeaderFooterOptions, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): File =
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val total = doc.numberOfPages
            val targets = PageRanges.pages(opt.pages, total).toSet()
            val fonts = FontKit(doc)
            val color = parseColor(opt.colorHex)
            val date = SimpleDateFormat("dd/MM/yyyy", Locale.FRANCE).format(Date())
            fun expand(t: String, n: Int) = t.replace("{n}", "$n").replace("{p}", "$total")
                .replace("{date}", date).replace("{fichier}", opt.fileName).replace("{file}", opt.fileName)
            val slots = listOf(
                Anchor.TOP_LEFT to opt.headerLeft, Anchor.TOP_CENTER to opt.headerCenter, Anchor.TOP_RIGHT to opt.headerRight,
                Anchor.BOTTOM_LEFT to opt.footerLeft, Anchor.BOTTOM_CENTER to opt.footerCenter, Anchor.BOTTOM_RIGHT to opt.footerRight,
            ).filter { it.second.isNotBlank() }
            if (slots.isEmpty()) throw EngineException(EngineError.EMPTY_INPUT, "Saisissez au moins un en-tête ou un pied de page")
            doc.pages.forEachIndexed { i, page ->
                ctx.progress(i.toFloat() / total)
                if ((i + 1) !in targets) return@forEachIndexed
                doc.drawOnPage(page) { cs, space ->
                    for ((anchor, template) in slots) {
                        val label = expand(template, i + 1)
                        val font = fonts.font(label)
                        val text = fonts.safeText(font, label)
                        val w = FontKit.width(font, text, opt.fontSize)
                        val (x, y) = place(anchor, space.width, space.height, w, opt.fontSize, opt.marginPt)
                        cs.beginText()
                        cs.setFont(font, opt.fontSize)
                        cs.setNonStrokingColor(color[0], color[1], color[2])
                        cs.newLineAtOffset(x, y)
                        cs.showText(text)
                        cs.endText()
                    }
                }
            }
            doc.save(output); output
        }

    // --- Géométrie -----------------------------------------------------------------------

    internal fun place(a: Anchor, pw: Float, ph: Float, textW: Float, size: Float, margin: Float): Pair<Float, Float> {
        val x = when (a.h) { 0 -> margin; 1 -> (pw - textW) / 2f; else -> pw - margin - textW }
        val y = when (a.v) { 0 -> margin; 1 -> (ph - size) / 2f; else -> ph - margin - size }
        return x to y
    }

    private fun anchorPoint(a: Anchor, pw: Float, ph: Float): Pair<Float, Float> {
        val x = when (a.h) { 0 -> pw * 0.2f; 1 -> pw / 2f; else -> pw * 0.8f }
        val y = when (a.v) { 0 -> ph * 0.15f; 1 -> ph / 2f; else -> ph * 0.85f }
        return x to y
    }

    private fun mosaicPositions(pw: Float, ph: Float): List<Pair<Float, Float>> {
        val list = mutableListOf<Pair<Float, Float>>()
        for (r in 0 until 4) for (c in 0 until 3) list += (pw * (c + 0.5f) / 3f) to (ph * (r + 0.5f) / 4f)
        return list
    }

    private fun mirror(a: Anchor): Anchor = Anchor.entries.first { it.v == a.v && it.h == 2 - a.h }
}
