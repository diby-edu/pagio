package com.pagio.engine

import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.state.RenderingMode
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import java.io.File
import java.io.StringWriter
import kotlin.math.abs

/** Un mot positionné, coordonnées « affichées » normalisées (0..1, origine en haut à gauche). */
data class Word(val text: String, val x: Float, val y: Float, val w: Float, val h: Float, val fontSize: Float, val bold: Boolean, val italic: Boolean)

/** Ligne de texte reconstituée sur une page. */
data class TextLine(val words: List<Word>) {
    val text: String get() = words.joinToString(" ") { it.text }
    val y: Float get() = words.minOf { it.y }
    val x: Float get() = words.minOf { it.x }
    val fontSize: Float get() = words.map { it.fontSize }.average().toFloat()
    val bold: Boolean get() = words.count { it.bold } * 2 > words.size
    val italic: Boolean get() = words.count { it.italic } * 2 > words.size
}

data class PageText(val index: Int, val width: Float, val height: Float, val lines: List<TextLine>) {
    val plain: String get() = lines.joinToString("\n") { it.text }
}

data class SearchHit(val page: Int, val snippet: String)

/** Ligne reconnue par l'OCR (coordonnées normalisées 0..1 sur l'image de la page). */
data class OcrLine(val text: String, val left: Float, val top: Float, val right: Float, val bottom: Float)

object PdfText {

    fun extractText(input: File, password: String? = null, startPage: Int = 1, endPage: Int = Int.MAX_VALUE): String =
        input.usePdf(password) { doc -> extractText(doc, startPage, endPage) }

    fun extractText(doc: PDDocument, startPage: Int = 1, endPage: Int = Int.MAX_VALUE): String {
        val s = PDFTextStripper().apply {
            sortByPosition = true
            this.startPage = startPage
            this.endPage = minOf(endPage, doc.numberOfPages)
        }
        return s.getText(doc)
    }

    /** Texte page par page (utile pour la recherche, l'IA et l'OCR conditionnel). */
    fun extractPages(input: File, password: String? = null, ctx: TaskContext = TaskContext.NONE): List<String> =
        input.usePdf(password) { doc ->
            (1..doc.numberOfPages).map { p ->
                ctx.progress(p.toFloat() / doc.numberOfPages)
                extractText(doc, p, p).trim()
            }
        }

    fun search(input: File, query: String, password: String? = null): List<SearchHit> {
        if (query.isBlank()) return emptyList()
        val q = query.lowercase()
        return extractPages(input, password).mapIndexedNotNull { i, text ->
            val idx = text.lowercase().indexOf(q)
            if (idx < 0) null else {
                val from = maxOf(0, idx - 40); val to = minOf(text.length, idx + q.length + 60)
                SearchHit(i + 1, text.substring(from, to).replace('\n', ' '))
            }
        }
    }

    /** Lignes et mots positionnés de chaque page (base des conversions Word/Excel et du remplacement). */
    fun layout(input: File, password: String? = null, ctx: TaskContext = TaskContext.NONE): List<PageText> =
        input.usePdf(password) { doc ->
            (0 until doc.numberOfPages).map { i ->
                ctx.progress(i.toFloat() / doc.numberOfPages)
                pageLayout(doc, i)
            }
        }

    fun pageLayout(doc: PDDocument, index: Int): PageText {
        val page = doc.getPage(index)
        val space = PageSpace(page)
        val words = mutableListOf<Word>()
        val stripper = object : PDFTextStripper() {
            override fun writeString(text: String, positions: MutableList<TextPosition>) {
                var current = mutableListOf<TextPosition>()
                fun flush() {
                    if (current.isEmpty()) return
                    val t = current.joinToString("") { it.unicode ?: "" }.trim()
                    if (t.isNotEmpty()) {
                        val x0 = current.minOf { it.xDirAdj }; val x1 = current.maxOf { it.xDirAdj + it.widthDirAdj }
                        val top = current.minOf { it.yDirAdj - it.heightDir }; val bottom = current.maxOf { it.yDirAdj }
                        val fontName = current.first().font?.name?.lowercase() ?: ""
                        val pw = current.first().pageWidth.takeIf { it > 0 } ?: space.width
                        val ph = current.first().pageHeight.takeIf { it > 0 } ?: space.height
                        words += Word(t, x0 / pw, top / ph, (x1 - x0) / pw, (bottom - top) / ph,
                            current.first().fontSizeInPt.takeIf { it > 0 } ?: current.first().fontSize,
                            fontName.contains("bold") || fontName.contains("black") || fontName.contains("heavy"),
                            fontName.contains("italic") || fontName.contains("oblique"))
                    }
                    current = mutableListOf()
                }
                for (p in positions) {
                    if (p.unicode.isNullOrBlank()) { flush(); continue }
                    current += p
                }
                flush()
            }
        }.apply { sortByPosition = true; startPage = index + 1; endPage = index + 1 }
        stripper.writeText(doc, StringWriter())
        return PageText(index, space.width, space.height, groupLines(words))
    }

    internal fun groupLines(words: List<Word>): List<TextLine> {
        val sorted = words.sortedWith(compareBy({ it.y + it.h / 2 }, { it.x }))
        val lines = mutableListOf<MutableList<Word>>()
        for (w in sorted) {
            val mid = w.y + w.h / 2
            val line = lines.lastOrNull()?.takeIf { l -> abs((l.first().y + l.first().h / 2) - mid) < maxOf(w.h, l.first().h) * 0.5f }
            if (line != null) line += w else lines += mutableListOf(w)
        }
        return lines.map { TextLine(it.sortedBy { w -> w.x }) }
    }

    /**
     * Extraction de tableaux : les lignes de texte sont découpées en colonnes là où les
     * espaces horizontaux sont nettement plus larges qu'un espace normal.
     */
    fun tables(pages: List<PageText>): List<List<List<String>>> = pages.map { page -> pageToRows(page) }

    fun pageToRows(page: PageText): List<List<String>> {
        if (page.lines.isEmpty()) return emptyList()
        // Bords gauches des « cellules » : début de chaque mot précédé d'un grand écart.
        val cellStarts = mutableListOf<Float>()
        val rows = page.lines.map { line ->
            val cells = mutableListOf<Pair<Float, StringBuilder>>()
            var prevEnd = -1f
            for (w in line.words) {
                val gap = w.x - prevEnd
                val big = prevEnd < 0 || gap > (w.h * 0.9f).coerceAtLeast(0.012f)
                if (big) { cells += w.x to StringBuilder(w.text); cellStarts += w.x }
                else cells.last().second.append(' ').append(w.text)
                prevEnd = w.x + w.w
            }
            cells
        }
        // Regroupement des débuts de cellules en colonnes communes.
        val columns = mutableListOf<Float>()
        for (x in cellStarts.sorted()) if (columns.isEmpty() || x - columns.last() > 0.035f) columns += x
        return rows.map { cells ->
            val out = MutableList(columns.size) { "" }
            for ((x, sb) in cells) {
                var col = columns.indexOfLast { it <= x + 0.017f }
                if (col < 0) col = 0
                out[col] = if (out[col].isEmpty()) sb.toString() else out[col] + " " + sb
            }
            out.dropLastWhile { it.isEmpty() }
        }
    }

    /**
     * Rend un PDF scanné consultable : ajoute, sous l'image, un calque de texte invisible
     * aligné sur les lignes reconnues par l'OCR. L'apparence du document ne change pas.
     */
    fun addInvisibleTextLayer(input: File, ocrPages: Map<Int, List<OcrLine>>, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): File =
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val fonts = FontKit(doc)
            for ((index, lines) in ocrPages) {
                ctx.progress(index.toFloat() / doc.numberOfPages, "Calque de texte page ${index + 1}")
                if (index !in 0 until doc.numberOfPages || lines.isEmpty()) continue
                val page = doc.getPage(index)
                doc.drawOnPage(page) { cs, space ->
                    cs.beginText()
                    cs.setRenderingMode(RenderingMode.NEITHER)
                    for (l in lines) {
                        val font = fonts.font(l.text)
                        val text = fonts.safeText(font, l.text)
                        if (text.isBlank()) continue
                        val h = (l.bottom - l.top) * space.height
                        val size = (h * 0.85f).coerceIn(2f, 200f)
                        val targetW = (l.right - l.left) * space.width
                        val naturalW = FontKit.width(font, text, size).coerceAtLeast(1f)
                        cs.setFont(font, size)
                        cs.setHorizontalScaling((targetW / naturalW * 100f).coerceIn(10f, 500f))
                        cs.setTextMatrix(com.tom_roush.pdfbox.util.Matrix(1f, 0f, 0f, 1f, l.left * space.width, (1f - l.bottom) * space.height + h * 0.15f))
                        cs.showText(text)
                    }
                    cs.endText()
                }
            }
            doc.save(output); output
        }

    /** Vrai si le document contient très peu de texte (probablement scanné). */
    fun looksScanned(input: File, password: String? = null): Boolean {
        val pages = extractPages(input, password)
        val chars = pages.sumOf { it.length }
        return chars < 30 * maxOf(1, pages.size)
    }

    @Suppress("unused")
    private val keepHelvetica = PDType1Font.HELVETICA
}
