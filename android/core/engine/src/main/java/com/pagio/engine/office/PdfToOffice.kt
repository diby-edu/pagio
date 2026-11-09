package com.pagio.engine.office

import android.graphics.Bitmap
import com.pagio.engine.EngineError
import com.pagio.engine.EngineException
import com.pagio.engine.PageText
import com.pagio.engine.PdfRender
import com.pagio.engine.PdfText
import com.pagio.engine.TaskContext
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Conversions PDF → Office réalisées sur l'appareil.
 * Limite assumée : la mise en page complexe (colonnes multiples, tableaux dessinés, images
 * dans le texte) est simplifiée. Pour une fidélité maximale, le serveur Pagio peut être utilisé.
 */
object PdfToOffice {

    /** PDF → Word : titres, gras/italique, paragraphes reconstitués, un saut de page par page. */
    fun toDocx(input: File, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): File {
        val pages = PdfText.layout(input, password, ctx)
        if (pages.all { it.lines.isEmpty() }) {
            throw EngineException(EngineError.NO_TEXT, "Aucun texte trouvé : ce PDF semble scanné. Lancez d'abord l'OCR pour le rendre lisible.")
        }
        DocxWriter.write(paragraphsOf(pages), output, input.nameWithoutExtension)
        return output
    }

    internal fun paragraphsOf(pages: List<PageText>): List<DocParagraph> {
        val sizes = pages.flatMap { p -> p.lines.map { it.fontSize } }.sorted()
        val body = if (sizes.isEmpty()) 11f else sizes[sizes.size / 2]
        val out = mutableListOf<DocParagraph>()
        pages.forEachIndexed { pi, page ->
            var buffer = mutableListOf<DocRun>()
            var bufStyle: String? = null
            var bufAlign: String? = null
            var lastBottom = -1f
            var lastSize = 0f
            var firstOfPage = pi > 0
            fun flush() {
                if (buffer.isEmpty()) return
                out += DocParagraph(buffer, bufStyle, bufAlign, pageBreakBefore = firstOfPage)
                firstOfPage = false
                buffer = mutableListOf()
            }
            for (line in page.lines) {
                val size = line.fontSize
                val style = when {
                    size >= body * 1.6f -> "Title"
                    size >= body * 1.3f -> "Heading1"
                    size >= body * 1.12f && line.bold -> "Heading2"
                    else -> null
                }
                val gap = if (lastBottom < 0) 0f else (line.y - lastBottom) * page.height
                val center = line.x > 0.25f && (line.words.last().x + line.words.last().w) < 0.75f &&
                    kotlin.math.abs((line.x + line.words.last().x + line.words.last().w) / 2f - 0.5f) < 0.04f
                val newPara = buffer.isEmpty() || style != bufStyle || style != null || gap > size * 0.9f ||
                    kotlin.math.abs(size - lastSize) > 1.5f || line.text.trimStart().startsWith("•") || line.text.trimStart().matches(Regex("^(\\d+[.)]|[-–]) .*"))
                if (newPara) {
                    flush(); bufStyle = style; bufAlign = if (center) "center" else null
                } else {
                    // Coupure de mot en fin de ligne : on recolle.
                    val last = buffer.lastOrNull()
                    if (last != null && last.text.endsWith("-")) buffer[buffer.size - 1] = last.copy(text = last.text.dropLast(1))
                    else buffer += DocRun(" ")
                }
                // Regroupe les mots de même style en un seul « run ».
                var run: DocRun? = null
                for (w in line.words) {
                    val explicitSize = if (style == null && kotlin.math.abs(w.fontSize - body) > 1f) w.fontSize else null
                    if (run != null && run.bold == w.bold && run.italic == w.italic && run.sizePt == explicitSize) {
                        run = run.copy(text = run.text + " " + w.text)
                    } else {
                        run?.let { buffer += it; buffer += DocRun(" ") }
                        run = DocRun(w.text, w.bold && style == null, w.italic, explicitSize)
                    }
                }
                run?.let { buffer += it }
                lastBottom = line.words.maxOf { it.y + it.h }
                lastSize = size
            }
            flush()
            if (page.lines.isEmpty()) out += DocParagraph(listOf(DocRun("")), pageBreakBefore = pi > 0)
        }
        return out
    }

    /** PDF → Excel : une feuille pour tout le document ou une feuille par page. */
    fun toXlsx(input: File, output: File, sheetPerPage: Boolean, ctx: TaskContext = TaskContext.NONE, password: String? = null): File {
        val pages = PdfText.layout(input, password, ctx)
        val tables = PdfText.tables(pages)
        if (tables.all { it.isEmpty() }) {
            throw EngineException(EngineError.NO_TEXT, "Aucune donnée trouvée : ce PDF semble scanné. Lancez d'abord l'OCR.")
        }
        val sheets = if (sheetPerPage) tables.mapIndexed { i, rows -> Sheet("Page ${i + 1}", rows) }
        else listOf(Sheet("Données", tables.flatMapIndexed { i, rows -> if (i == 0) rows else listOf(emptyList<String>()) + rows }))
        XlsxWriter.write(sheets, output)
        return output
    }

    enum class PptMode { IMAGE, EDITABLE_TEXT }

    /** PDF → PowerPoint : chaque page devient une diapositive (image fidèle ou texte modifiable). */
    fun toPptx(input: File, output: File, mode: PptMode, ctx: TaskContext = TaskContext.NONE, password: String? = null): File {
        val sizes = PdfRender.pageSizes(input)
        if (sizes.isEmpty()) throw EngineException(EngineError.EMPTY_INPUT, "Document vide")
        val (wPt, hPt) = sizes.first()
        val slides = mutableListOf<Slide>()
        if (mode == PptMode.IMAGE) {
            PdfRender.open(input) { r ->
                for (i in 0 until r.pageCount) {
                    ctx.progress(i.toFloat() / r.pageCount, "Diapositive ${i + 1}")
                    val page = r.openPage(i)
                    val bmp = try { PdfRender.render(page, 1600f / page.width) } finally { page.close() }
                    val bytes = ByteArrayOutputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it); it.toByteArray() }
                    bmp.recycle()
                    slides += Slide(imageJpeg = bytes)
                }
            }
        } else {
            val pages = PdfText.layout(input, password, ctx)
            val emuW = wPt * PptxWriter.EMU_PER_PT
            val emuH = hPt * PptxWriter.EMU_PER_PT
            for (p in pages) {
                slides += Slide(texts = p.lines.map { l ->
                    val right = l.words.maxOf { it.x + it.w }
                    SlideText(l.text, (l.x * emuW).toLong(), (l.y * emuH).toLong(), ((right - l.x) * emuW * 1.08f).toLong().coerceAtLeast(12700),
                        (l.words.maxOf { it.h } * emuH * 1.3f).toLong().coerceAtLeast(12700), l.fontSize * (wPt / p.width), l.bold)
                })
            }
        }
        PptxWriter.write(slides, wPt.toFloat(), hPt.toFloat(), output)
        return output
    }
}
