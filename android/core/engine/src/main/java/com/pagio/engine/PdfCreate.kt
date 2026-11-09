package com.pagio.engine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix as AMatrix
import android.media.ExifInterface
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import java.io.File

enum class PageSize(val widthPt: Float, val heightPt: Float, val label: String) {
    A4(595.28f, 841.89f, "A4"),
    A5(419.53f, 595.28f, "A5"),
    A3(841.89f, 1190.55f, "A3"),
    LETTER(612f, 792f, "Lettre US"),
    LEGAL(612f, 1008f, "Legal US"),
    FIT(0f, 0f, "Taille de l'image"),
}

enum class Orientation { AUTO, PORTRAIT, LANDSCAPE }

data class ImagePdfOptions(
    val pageSize: PageSize = PageSize.A4,
    val orientation: Orientation = Orientation.AUTO,
    val marginPt: Float = 0f,
    val jpegQuality: Float = 0.85f,
    val maxDimension: Int = 2480,      // ~300 dpi sur A4 : bon compromis taille/netteté
)

data class BlankPdfOptions(
    val pageSize: PageSize = PageSize.A4,
    val orientation: Orientation = Orientation.PORTRAIT,
    val pages: Int = 1,
    val backgroundHex: String = "#FFFFFF",
    val pattern: String = "blank",     // blank, lines, grid, dots
)

data class TextPdfOptions(
    val pageSize: PageSize = PageSize.A4,
    val fontSize: Float = 11f,
    val marginPt: Float = 56f,
    val monospace: Boolean = false,
    val title: String? = null,
)

object PdfCreate {

    /** Une image = une page. Respecte l'orientation EXIF des photos. */
    fun imagesToPdf(images: List<File>, opt: ImagePdfOptions, output: File, ctx: TaskContext = TaskContext.NONE): File {
        if (images.isEmpty()) throw EngineException(EngineError.EMPTY_INPUT, "Aucune image sélectionnée")
        PDDocument().use { doc ->
            images.forEachIndexed { i, f ->
                ctx.progress(i.toFloat() / images.size, "Image ${i + 1}/${images.size}")
                val bmp = loadBitmap(f, opt.maxDimension)
                    ?: throw EngineException(EngineError.UNSUPPORTED_FORMAT, "« ${f.name} » n'est pas une image lisible")
                val pdImage = if (bmp.hasAlpha() && f.extension.lowercase() == "png") LosslessFactory.createFromImage(doc, bmp)
                else JPEGFactory.createFromImage(doc, bmp, opt.jpegQuality)
                val landscape = when (opt.orientation) {
                    Orientation.LANDSCAPE -> true
                    Orientation.PORTRAIT -> false
                    Orientation.AUTO -> bmp.width > bmp.height
                }
                val rect = if (opt.pageSize == PageSize.FIT) {
                    // 1 pixel = 0,75 pt (96 dpi) : taille naturelle de l'image.
                    PDRectangle(bmp.width * 0.75f + 2 * opt.marginPt, bmp.height * 0.75f + 2 * opt.marginPt)
                } else if (landscape) PDRectangle(opt.pageSize.heightPt, opt.pageSize.widthPt)
                else PDRectangle(opt.pageSize.widthPt, opt.pageSize.heightPt)
                val page = PDPage(rect)
                doc.addPage(page)
                val availW = rect.width - 2 * opt.marginPt
                val availH = rect.height - 2 * opt.marginPt
                val scale = minOf(availW / bmp.width, availH / bmp.height)
                val w = bmp.width * scale
                val h = bmp.height * scale
                PDPageContentStream(doc, page).use { cs ->
                    cs.drawImage(pdImage, (rect.width - w) / 2f, (rect.height - h) / 2f, w, h)
                }
                bmp.recycle()
            }
            ctx.progress(0.97f, "Enregistrement…")
            doc.save(output)
        }
        return output
    }

    fun loadBitmap(f: File, maxDimension: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.absolutePath, bounds)
        if (bounds.outWidth <= 0) return null
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxDimension || bounds.outHeight / (sample * 2) >= maxDimension) sample *= 2
        val bmp = BitmapFactory.decodeFile(f.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val rotation = runCatching {
            when (ExifInterface(f.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        }.getOrDefault(0f)
        if (rotation == 0f) return bmp
        val m = AMatrix().apply { postRotate(rotation) }
        return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true).also { if (it != bmp) bmp.recycle() }
    }

    /** Texte brut → PDF paginé, avec retour à la ligne automatique. */
    fun textToPdf(text: String, opt: TextPdfOptions, output: File, ctx: TaskContext = TaskContext.NONE): File {
        PDDocument().use { doc ->
            val fonts = FontKit(doc)
            val font = fonts.font(text.take(5000), family = if (opt.monospace) "mono" else "sans")
            val bold = fonts.font(opt.title ?: "", bold = true)
            val rect = PDRectangle(opt.pageSize.widthPt.takeIf { it > 0 } ?: 595.28f, opt.pageSize.heightPt.takeIf { it > 0 } ?: 841.89f)
            val maxW = rect.width - 2 * opt.marginPt
            val leading = opt.fontSize * 1.4f
            val lines = wrapText(font, fonts.safeText(font, text), opt.fontSize, maxW)
            val linesPerPage = ((rect.height - 2 * opt.marginPt) / leading).toInt().coerceAtLeast(1)
            var index = 0
            var first = true
            do {
                ctx.progress(index.toFloat() / maxOf(1, lines.size))
                val page = PDPage(rect); doc.addPage(page)
                PDPageContentStream(doc, page).use { cs ->
                    var y = rect.height - opt.marginPt - opt.fontSize
                    if (first && !opt.title.isNullOrBlank()) {
                        cs.beginText(); cs.setFont(bold, opt.fontSize * 1.6f)
                        cs.newLineAtOffset(opt.marginPt, y); cs.showText(fonts.safeText(bold, opt.title)); cs.endText()
                        y -= leading * 2
                    }
                    cs.setFont(font, opt.fontSize)
                    while (index < lines.size && y > opt.marginPt) {
                        cs.beginText(); cs.newLineAtOffset(opt.marginPt, y); cs.showText(lines[index]); cs.endText()
                        y -= leading; index++
                    }
                }
                first = false
            } while (index < lines.size)
            if (linesPerPage <= 0) error("page trop petite")
            doc.save(output)
        }
        return output
    }

    /** Nouveau document vierge, uni ou avec un motif (lignes, quadrillage, points). */
    fun blankPdf(opt: BlankPdfOptions, output: File): File {
        PDDocument().use { doc ->
            val base = if (opt.pageSize == PageSize.FIT) PageSize.A4 else opt.pageSize
            val rect = if (opt.orientation == Orientation.LANDSCAPE) PDRectangle(base.heightPt, base.widthPt) else PDRectangle(base.widthPt, base.heightPt)
            val bg = parseColor(opt.backgroundHex)
            repeat(opt.pages.coerceIn(1, 500)) {
                val page = PDPage(rect); doc.addPage(page)
                PDPageContentStream(doc, page).use { cs ->
                    if (opt.backgroundHex.uppercase() != "#FFFFFF") {
                        cs.setNonStrokingColor(bg[0], bg[1], bg[2]); cs.addRect(0f, 0f, rect.width, rect.height); cs.fill()
                    }
                    cs.setStrokingColor(0.78f, 0.80f, 0.86f); cs.setNonStrokingColor(0.70f, 0.72f, 0.78f); cs.setLineWidth(0.5f)
                    val step = 22f
                    when (opt.pattern) {
                        "lines" -> { var y = rect.height - 60f; while (y > 40f) { cs.moveTo(40f, y); cs.lineTo(rect.width - 40f, y); y -= step }; cs.stroke() }
                        "grid" -> {
                            var x = 0f; while (x <= rect.width) { cs.moveTo(x, 0f); cs.lineTo(x, rect.height); x += step }
                            var y = 0f; while (y <= rect.height) { cs.moveTo(0f, y); cs.lineTo(rect.width, y); y += step }
                            cs.stroke()
                        }
                        "dots" -> {
                            var x = step; while (x < rect.width) { var y = step; while (y < rect.height) { cs.addRect(x - 0.6f, y - 0.6f, 1.2f, 1.2f); y += step }; x += step }
                            cs.fill()
                        }
                    }
                }
            }
            doc.save(output)
        }
        return output
    }
}
