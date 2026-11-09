package com.pagio.engine.office

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Xml
import com.pagio.engine.EngineError
import com.pagio.engine.EngineException
import com.pagio.engine.FontKit
import com.pagio.engine.TaskContext
import com.pagio.engine.parseColor
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import org.xmlpull.v1.XmlPullParser
import java.io.File
import java.util.zip.ZipFile

data class RichRun(val text: String, val bold: Boolean = false, val italic: Boolean = false, val sizePt: Float = 11f,
                   val colorHex: String = "#000000", val underline: Boolean = false)

/**
 * Mise en page simple de texte riche sur des pages PDF (paragraphes, titres, listes, tableaux,
 * images). Sert aux conversions Word/Excel/PowerPoint → PDF réalisées sur l'appareil.
 */
internal class Flow(private val doc: PDDocument, private val pageRect: PDRectangle, private val margin: Float = 56f) {
    private val fonts = FontKit(doc)
    private var cs: PDPageContentStream? = null
    private var y = 0f
    var autoPage = true
    val contentWidth get() = pageRect.width - 2 * margin

    private fun stream(): PDPageContentStream = cs ?: newPage()

    fun newPage(): PDPageContentStream {
        cs?.close()
        val page = PDPage(pageRect); doc.addPage(page)
        y = pageRect.height - margin
        return PDPageContentStream(doc, page).also { cs = it }
    }

    fun pageBreak() { newPage() }
    fun space(pt: Float) { y -= pt; if (y < margin) newPage() }

    private data class Token(val text: String, val run: RichRun, val width: Float, val space: Boolean)

    fun paragraph(runs: List<RichRun>, align: String? = null, indent: Float = 0f, bullet: String? = null, after: Float = 6f, maxWidth: Float = contentWidth, x0: Float = margin) {
        stream()
        val tokens = mutableListOf<Token>()
        for (r in runs) {
            val parts = r.text.replace('\t', ' ').split(Regex("(?<= )|(?= )"))
            for (p in parts) {
                if (p.isEmpty()) continue
                val font = fonts.font(p, r.bold, r.italic)
                val safe = fonts.safeText(font, p)
                tokens += Token(safe, r, FontKit.width(font, safe, r.sizePt), p.isBlank())
            }
        }
        if (tokens.isEmpty()) { space(runs.firstOrNull()?.sizePt ?: 11f); return }
        val avail = maxWidth - indent
        var line = mutableListOf<Token>(); var lineW = 0f
        var first = true
        fun emit(last: Boolean) {
            while (line.isNotEmpty() && line.last().space) { lineW -= line.last().width; line.removeAt(line.size - 1) }
            if (line.isEmpty()) return
            val size = line.maxOf { it.run.sizePt }
            val lh = size * 1.3f
            if (y - lh < margin && autoPage) newPage()
            y -= size
            var x = x0 + indent + when (align) {
                "center" -> (avail - lineW) / 2f
                "right" -> avail - lineW
                else -> 0f
            }
            val c = stream()
            if (first && bullet != null) {
                val f = fonts.font(bullet)
                c.beginText(); c.setFont(f, size); c.setNonStrokingColor(0.2f, 0.2f, 0.2f)
                c.newLineAtOffset(x - 14f, y); c.showText(fonts.safeText(f, bullet)); c.endText()
            }
            for (t in line) {
                if (!t.space) {
                    val f = fonts.font(t.text, t.run.bold, t.run.italic)
                    val col = parseColor(t.run.colorHex)
                    c.beginText(); c.setFont(f, t.run.sizePt); c.setNonStrokingColor(col[0], col[1], col[2])
                    c.newLineAtOffset(x, y); c.showText(t.text); c.endText()
                    if (t.run.underline) { c.setStrokingColor(col[0], col[1], col[2]); c.setLineWidth(0.6f); c.moveTo(x, y - 1.5f); c.lineTo(x + t.width, y - 1.5f); c.stroke() }
                }
                x += t.width
            }
            y -= lh - size
            first = false
            line = mutableListOf(); lineW = 0f
        }
        for (t in tokens) {
            if (lineW + t.width > avail && line.isNotEmpty() && !t.space) emit(false)
            if (line.isEmpty() && t.space) continue
            line += t; lineW += t.width
        }
        emit(true)
        y -= after
    }

    fun image(bmp: Bitmap, maxW: Float = contentWidth, maxH: Float = pageRect.height - 2 * margin) {
        stream()
        val scale = minOf(maxW / bmp.width, maxH / bmp.height, 0.75f)
        val w = bmp.width * scale; val h = bmp.height * scale
        if (y - h < margin) newPage()
        val img = if (bmp.hasAlpha()) LosslessFactory.createFromImage(doc, bmp) else JPEGFactory.createFromImage(doc, bmp, 0.85f)
        y -= h
        stream().drawImage(img, margin + (contentWidth - w) / 2f, y, w, h)
        y -= 8f
    }

    /** Tableau : colonnes de largeur proportionnelle au contenu, bordures fines, pagination. */
    fun table(rows: List<List<List<RichRun>>>, fontSize: Float = 9.5f) {
        stream()
        if (rows.isEmpty()) return
        val cols = rows.maxOf { it.size }.coerceAtLeast(1)
        val weights = (0 until cols).map { c -> rows.maxOf { r -> r.getOrNull(c)?.sumOf { it.text.length } ?: 0 }.coerceIn(3, 40).toFloat() }
        val total = weights.sum()
        val widths = weights.map { it / total * contentWidth }
        val pad = 3f
        for (row in rows) {
            // Hauteur de la ligne = cellule la plus haute.
            val cellLines = (0 until cols).map { c ->
                val text = row.getOrNull(c)?.joinToString("") { it.text } ?: ""
                val bold = row.getOrNull(c)?.any { it.bold } == true
                val f = fonts.font(text, bold)
                com.pagio.engine.wrapText(f, fonts.safeText(f, text), fontSize, widths[c] - 2 * pad) to f
            }
            val h = cellLines.maxOf { it.first.size } * fontSize * 1.25f + 2 * pad
            if (y - h < margin) newPage()
            val c = stream()
            var x = margin
            c.setStrokingColor(0.6f, 0.62f, 0.7f); c.setLineWidth(0.5f)
            for (i in 0 until cols) {
                c.addRect(x, y - h, widths[i], h); c.stroke()
                var ty = y - pad - fontSize
                val (lines, f) = cellLines[i]
                for (l in lines) {
                    c.beginText(); c.setFont(f, fontSize); c.setNonStrokingColor(0.1f, 0.1f, 0.1f)
                    c.newLineAtOffset(x + pad, ty); c.showText(l); c.endText(); ty -= fontSize * 1.25f
                }
                x += widths[i]
            }
            y -= h
        }
        y -= 8f
    }

    /** Texte positionné librement (diapositives). */
    fun textAt(runs: List<RichRun>, x: Float, top: Float, width: Float, align: String?) {
        val saved = y
        y = top
        autoPage = false
        paragraph(runs, align, after = 2f, maxWidth = width, x0 = x)
        autoPage = true
        y = saved
    }

    fun imageAt(bmp: Bitmap, x: Float, top: Float, w: Float, h: Float) {
        val img = if (bmp.hasAlpha()) LosslessFactory.createFromImage(doc, bmp) else JPEGFactory.createFromImage(doc, bmp, 0.88f)
        stream().drawImage(img, x, top - h, w, h)
    }

    fun close() { cs?.close(); cs = null }
}

/** Conversions Office → PDF sur l'appareil (formats modernes .docx, .xlsx, .pptx). */
object OfficeToPdf {

    fun supported(file: File): Boolean = file.extension.lowercase() in setOf("docx", "xlsx", "pptx")

    fun convert(input: File, output: File, ctx: TaskContext = TaskContext.NONE): File {
        val zip = try { ZipFile(input) } catch (e: Exception) {
            throw EngineException(EngineError.UNSUPPORTED_FORMAT,
                "« ${input.name} » n'est pas un document Office moderne (.docx, .xlsx, .pptx). Les anciens formats (.doc, .xls, .ppt) nécessitent le serveur de conversion.", e)
        }
        zip.use { z ->
            when {
                z.getEntry("word/document.xml") != null -> docx(z, output, ctx)
                z.getEntry("xl/workbook.xml") != null -> xlsx(z, output, ctx)
                z.getEntry("ppt/presentation.xml") != null -> pptx(z, output, ctx)
                else -> throw EngineException(EngineError.UNSUPPORTED_FORMAT, "Format Office non reconnu")
            }
        }
        return output
    }

    private fun parser(z: ZipFile, path: String): XmlPullParser? {
        val e = z.getEntry(path) ?: return null
        return Xml.newPullParser().apply {
            setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
            setInput(z.getInputStream(e), "UTF-8")
        }
    }

    private fun rels(z: ZipFile, path: String): Map<String, String> {
        val p = parser(z, path) ?: return emptyMap()
        val map = HashMap<String, String>()
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            if (p.eventType == XmlPullParser.START_TAG && p.name == "Relationship") {
                map[p.getAttributeValue(null, "Id")] = p.getAttributeValue(null, "Target")
            }
        }
        return map
    }

    private fun resolve(base: String, target: String): String {
        if (target.startsWith("/")) return target.removePrefix("/")
        val parts = base.substringBeforeLast('/').split('/').toMutableList()
        for (seg in target.split('/')) { if (seg == "..") parts.removeAt(parts.size - 1) else if (seg != ".") parts += seg }
        return parts.joinToString("/")
    }

    private fun bitmap(z: ZipFile, path: String): Bitmap? = z.getEntry(path)?.let { e ->
        z.getInputStream(e).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = 1 }) }
    }

    // ----------------------------------------------------------------------------- DOCX

    private fun docx(z: ZipFile, output: File, ctx: TaskContext) {
        val rel = rels(z, "word/_rels/document.xml.rels")
        val p = parser(z, "word/document.xml")!!
        PDDocument().use { doc ->
            val flow = Flow(doc, PDRectangle(595.28f, 841.89f), 62f)
            var runs = mutableListOf<RichRun>()
            var style: String? = null; var align: String? = null; var list = false
            var bold = false; var italic = false; var underline = false; var size = 11f; var color = "#000000"
            var inRun = false; var inText = false
            var tableDepth = 0
            var table = mutableListOf<MutableList<List<RichRun>>>()
            var cellRuns = mutableListOf<RichRun>()
            var count = 0
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                val name = p.name
                when (p.eventType) {
                    XmlPullParser.START_TAG -> when (name) {
                        "w:p" -> if (tableDepth == 0) { runs = mutableListOf(); style = null; align = null; list = false }
                        "w:pStyle" -> style = p.getAttributeValue(null, "w:val")
                        "w:jc" -> align = when (p.getAttributeValue(null, "w:val")) { "center" -> "center"; "right", "end" -> "right"; else -> null }
                        "w:numPr" -> list = true
                        "w:r" -> { inRun = true; bold = false; italic = false; underline = false; size = 11f; color = "#000000" }
                        "w:b" -> if (inRun) bold = p.getAttributeValue(null, "w:val") != "0" && p.getAttributeValue(null, "w:val") != "false"
                        "w:i" -> if (inRun) italic = p.getAttributeValue(null, "w:val") != "0" && p.getAttributeValue(null, "w:val") != "false"
                        "w:u" -> if (inRun) underline = p.getAttributeValue(null, "w:val") != "none"
                        "w:sz" -> if (inRun) p.getAttributeValue(null, "w:val")?.toFloatOrNull()?.let { size = it / 2f }
                        "w:color" -> if (inRun) p.getAttributeValue(null, "w:val")?.takeIf { it.length == 6 }?.let { color = "#$it" }
                        "w:t" -> inText = true
                        "w:tab" -> if (inRun) (if (tableDepth > 0) cellRuns else runs) += RichRun("    ", bold, italic, size, color)
                        "w:br" -> if (p.getAttributeValue(null, "w:type") == "page") { flushPara(flow, runs, style, align, list); runs = mutableListOf(); flow.pageBreak() }
                        "w:tbl" -> { if (tableDepth == 0) table = mutableListOf(); tableDepth++ }
                        "w:tr" -> if (tableDepth == 1) table.add(mutableListOf())
                        "w:tc" -> if (tableDepth == 1) cellRuns = mutableListOf()
                        "a:blip" -> {
                            val id = p.getAttributeValue(null, "r:embed")
                            val target = id?.let { rel[it] }
                            if (target != null) {
                                flushPara(flow, runs, style, align, list); runs = mutableListOf()
                                bitmap(z, resolve("word/document.xml", target))?.let { flow.image(it) }
                            }
                        }
                    }
                    XmlPullParser.TEXT -> if (inText) {
                        val r = RichRun(p.text, bold || style.isHeading(), italic, headingSize(style) ?: size, color, underline)
                        if (tableDepth > 0) cellRuns += r else runs += r
                    }
                    XmlPullParser.END_TAG -> when (name) {
                        "w:t" -> inText = false
                        "w:r" -> inRun = false
                        "w:p" -> if (tableDepth == 0) {
                            flushPara(flow, runs, style, align, list)
                            if (++count % 20 == 0) ctx.progress(0.5f, "Mise en page…")
                        } else cellRuns += RichRun(" ")
                        "w:tc" -> if (tableDepth == 1) table.lastOrNull()?.add(cellRuns.toList())
                        "w:tbl" -> { tableDepth--; if (tableDepth == 0) flow.table(table) }
                    }
                }
            }
            flow.close()
            if (doc.numberOfPages == 0) doc.addPage(PDPage(PDRectangle.A4))
            doc.save(output)
        }
    }

    private fun String?.isHeading() = this != null && (startsWith("Heading") || startsWith("Titre") || this == "Title" || startsWith("berschrift"))
    private fun headingSize(style: String?): Float? = when {
        style == null -> null
        style == "Title" || style == "Titre" -> 24f
        style.endsWith("1") && style.isHeading() -> 18f
        style.endsWith("2") && style.isHeading() -> 15f
        style.isHeading() -> 13f
        else -> null
    }

    private fun flushPara(flow: Flow, runs: List<RichRun>, style: String?, align: String?, list: Boolean) {
        if (runs.isEmpty()) { flow.space(8f); return }
        if (style.isHeading()) flow.space(6f)
        flow.paragraph(runs, align, indent = if (list) 18f else 0f, bullet = if (list) "•" else null, after = if (style.isHeading()) 8f else 6f)
    }

    // ----------------------------------------------------------------------------- XLSX

    private fun xlsx(z: ZipFile, output: File, ctx: TaskContext) {
        val shared = mutableListOf<String>()
        parser(z, "xl/sharedStrings.xml")?.let { p ->
            var current: StringBuilder? = null; var inT = false
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                when (p.eventType) {
                    XmlPullParser.START_TAG -> when (p.name) { "si" -> current = StringBuilder(); "t" -> inT = true }
                    XmlPullParser.TEXT -> if (inT) current?.append(p.text)
                    XmlPullParser.END_TAG -> when (p.name) { "t" -> inT = false; "si" -> { shared += current.toString(); current = null } }
                }
            }
        }
        val wbRels = rels(z, "xl/_rels/workbook.xml.rels")
        val sheets = mutableListOf<Pair<String, String>>()
        parser(z, "xl/workbook.xml")!!.let { p ->
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                if (p.eventType == XmlPullParser.START_TAG && p.name == "sheet") {
                    val target = wbRels[p.getAttributeValue(null, "r:id")] ?: continue
                    sheets += p.getAttributeValue(null, "name") to resolve("xl/workbook.xml", target)
                }
            }
        }
        PDDocument().use { doc ->
            sheets.forEachIndexed { si, (name, path) ->
                ctx.progress(si.toFloat() / sheets.size, "Feuille « $name »")
                val grid = readSheet(z, path, shared)
                if (grid.isEmpty()) return@forEachIndexed
                val cols = grid.maxOf { it.size }
                val landscape = cols > 6
                val flow = Flow(doc, if (landscape) PDRectangle(841.89f, 595.28f) else PDRectangle(595.28f, 841.89f), 36f)
                flow.paragraph(listOf(RichRun(name, bold = true, sizePt = 14f)))
                val fontSize = when { cols > 14 -> 6.5f; cols > 9 -> 7.5f; else -> 9f }
                flow.table(grid.mapIndexed { r, row -> row.map { listOf(RichRun(it, bold = r == 0)) } }, fontSize)
                flow.close()
            }
            if (doc.numberOfPages == 0) throw EngineException(EngineError.EMPTY_INPUT, "Le classeur est vide")
            doc.save(output)
        }
    }

    private fun readSheet(z: ZipFile, path: String, shared: List<String>): List<List<String>> {
        val p = parser(z, path) ?: return emptyList()
        val cells = HashMap<Pair<Int, Int>, String>()
        var ref = ""; var type: String? = null; var inV = false; var inT = false
        val value = StringBuilder()
        var maxR = -1; var maxC = -1
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            when (p.eventType) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "c" -> { ref = p.getAttributeValue(null, "r") ?: ""; type = p.getAttributeValue(null, "t"); value.clear() }
                    "v" -> inV = true
                    "t" -> inT = true
                }
                XmlPullParser.TEXT -> if (inV || inT) value.append(p.text)
                XmlPullParser.END_TAG -> when (p.name) {
                    "v" -> inV = false
                    "t" -> inT = false
                    "c" -> {
                        val raw = value.toString()
                        val text = when (type) {
                            "s" -> raw.toIntOrNull()?.let { shared.getOrNull(it) } ?: ""
                            "b" -> if (raw == "1") "VRAI" else "FAUX"
                            else -> raw.toDoubleOrNull()?.let { d -> if (d == Math.floor(d) && kotlin.math.abs(d) < 1e15) d.toLong().toString() else "%.2f".format(java.util.Locale.FRANCE, d) } ?: raw
                        }
                        val (r, c) = cellIndex(ref)
                        if (text.isNotEmpty() && r < 5000 && c < 60) { cells[r to c] = text; maxR = maxOf(maxR, r); maxC = maxOf(maxC, c) }
                    }
                }
            }
        }
        return (0..maxR).map { r -> (0..maxC).map { c -> cells[r to c] ?: "" } }
    }

    internal fun cellIndex(ref: String): Pair<Int, Int> {
        var col = 0; var i = 0
        while (i < ref.length && ref[i].isLetter()) { col = col * 26 + (ref[i].uppercaseChar() - 'A' + 1); i++ }
        val row = ref.substring(i).toIntOrNull() ?: 1
        return (row - 1) to (col - 1).coerceAtLeast(0)
    }

    // ----------------------------------------------------------------------------- PPTX

    private fun pptx(z: ZipFile, output: File, ctx: TaskContext) {
        var cx = 9144000L; var cy = 6858000L
        val ids = mutableListOf<String>()
        parser(z, "ppt/presentation.xml")!!.let { p ->
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                if (p.eventType != XmlPullParser.START_TAG) continue
                if (p.name == "p:sldSz") { cx = p.getAttributeValue(null, "cx").toLong(); cy = p.getAttributeValue(null, "cy").toLong() }
                if (p.name == "p:sldId") ids += p.getAttributeValue(null, "r:id")
            }
        }
        val presRels = rels(z, "ppt/_rels/presentation.xml.rels")
        val w = cx / 12700f; val h = cy / 12700f
        PDDocument().use { doc ->
            ids.forEachIndexed { i, id ->
                ctx.progress(i.toFloat() / ids.size, "Diapositive ${i + 1}")
                val path = resolve("ppt/presentation.xml", presRels[id] ?: return@forEachIndexed)
                val flow = Flow(doc, PDRectangle(w, h), 0f)
                flow.newPage()
                renderSlide(z, path, flow, h)
                flow.close()
            }
            if (doc.numberOfPages == 0) throw EngineException(EngineError.EMPTY_INPUT, "La présentation est vide")
            doc.save(output)
        }
    }

    private fun renderSlide(z: ZipFile, path: String, flow: Flow, pageH: Float) {
        val rel = rels(z, path.substringBeforeLast('/') + "/_rels/" + path.substringAfterLast('/') + ".rels")
        val p = parser(z, path) ?: return
        var x = 0f; var y = 0f; var ew = 0f; var eh = 0f
        var paras = mutableListOf<List<RichRun>>(); var runs = mutableListOf<RichRun>()
        var size = 18f; var bold = false; var inT = false; var align: String? = null
        var blip: String? = null
        var depth = 0
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            when (p.eventType) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "p:sp", "p:pic" -> { depth++; paras = mutableListOf(); runs = mutableListOf(); blip = null; ew = 0f }
                    "a:off" -> { x = p.getAttributeValue(null, "x").toFloat() / 12700f; y = p.getAttributeValue(null, "y").toFloat() / 12700f }
                    "a:ext" -> { ew = p.getAttributeValue(null, "cx").toFloat() / 12700f; eh = p.getAttributeValue(null, "cy").toFloat() / 12700f }
                    "a:pPr" -> align = when (p.getAttributeValue(null, "algn")) { "ctr" -> "center"; "r" -> "right"; else -> null }
                    "a:rPr", "a:defRPr", "a:endParaRPr" -> {
                        p.getAttributeValue(null, "sz")?.toFloatOrNull()?.let { size = it / 100f }
                        bold = p.getAttributeValue(null, "b") == "1"
                    }
                    "a:t" -> inT = true
                    "a:blip" -> blip = p.getAttributeValue(null, "r:embed")
                }
                XmlPullParser.TEXT -> if (inT) runs += RichRun(p.text, bold, false, size)
                XmlPullParser.END_TAG -> when (p.name) {
                    "a:t" -> inT = false
                    "a:p" -> { paras += runs.toList(); runs = mutableListOf() }
                    "p:sp" -> {
                        depth--
                        if (ew > 0) { var top = pageH - y; for (para in paras) { if (para.isNotEmpty()) flow.textAt(para, x, top, ew, align); top -= (para.maxOfOrNull { it.sizePt } ?: 12f) * 1.35f * maxOf(1, (para.sumOf { it.text.length } * (para.maxOfOrNull { it.sizePt } ?: 12f) * 0.5f / maxOf(ew, 1f)).toInt() + 1) } }
                    }
                    "p:pic" -> {
                        depth--
                        val target = blip?.let { rel[it] }
                        if (target != null && ew > 0) bitmap(z, resolve(path, target))?.let { flow.imageAt(it, x, pageH - y, ew, eh) }
                    }
                }
            }
        }
    }
}
