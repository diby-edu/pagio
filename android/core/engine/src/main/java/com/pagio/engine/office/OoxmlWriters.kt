package com.pagio.engine.office

import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Échappement XML minimal pour le contenu texte et les attributs. */
internal fun xml(s: String): String = buildString(s.length) {
    for (c in s) when (c) {
        '&' -> append("&amp;"); '<' -> append("&lt;"); '>' -> append("&gt;")
        '"' -> append("&quot;"); '\'' -> append("&apos;")
        else -> if (c.code < 0x20 && c != '\t' && c != '\n' && c != '\r') Unit else append(c)
    }
}

internal class ZipWriter(file: File) : AutoCloseable {
    private val zip = ZipOutputStream(FileOutputStream(file))
    fun text(path: String, content: String) { zip.putNextEntry(ZipEntry(path)); zip.write(content.toByteArray(Charsets.UTF_8)); zip.closeEntry() }
    fun bytes(path: String, content: ByteArray) { zip.putNextEntry(ZipEntry(path)); zip.write(content); zip.closeEntry() }
    override fun close() = zip.close()
}

private const val XML_HEAD = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"

// ============================================================================================
// DOCX
// ============================================================================================

/** Paragraphe destiné à un document Word. */
data class DocParagraph(
    val runs: List<DocRun>,
    val style: String? = null,         // "Heading1", "Heading2", "Title" ou null
    val align: String? = null,         // "center", "right", "both"
    val pageBreakBefore: Boolean = false,
    val indentTwips: Int = 0,
)

data class DocRun(val text: String, val bold: Boolean = false, val italic: Boolean = false, val sizePt: Float? = null)

object DocxWriter {
    fun write(paragraphs: List<DocParagraph>, output: File, title: String = "Document") {
        ZipWriter(output).use { z ->
            z.text("[Content_Types].xml", XML_HEAD +
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
                "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
                "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
                "</Types>")
            z.text("_rels/.rels", XML_HEAD +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
                "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
                "</Relationships>")
            z.text("docProps/core.xml", XML_HEAD +
                "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">" +
                "<dc:title>${xml(title)}</dc:title><dc:creator>Pagio</dc:creator></cp:coreProperties>")
            z.text("word/_rels/document.xml.rels", XML_HEAD +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
                "</Relationships>")
            z.text("word/styles.xml", XML_HEAD +
                "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
                "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/><w:sz w:val=\"22\"/><w:lang w:val=\"fr-FR\"/></w:rPr></w:rPrDefault>" +
                "<w:pPrDefault><w:pPr><w:spacing w:after=\"120\" w:line=\"264\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>" +
                "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>" +
                heading("Title", "Title", 36) + heading("Heading1", "heading 1", 28) + heading("Heading2", "heading 2", 24) +
                "</w:styles>")
            val body = StringBuilder()
            for (p in paragraphs) {
                body.append("<w:p><w:pPr>")
                p.style?.let { body.append("<w:pStyle w:val=\"$it\"/>") }
                if (p.pageBreakBefore) body.append("<w:pageBreakBefore/>")
                if (p.indentTwips > 0) body.append("<w:ind w:left=\"${p.indentTwips}\"/>")
                p.align?.let { body.append("<w:jc w:val=\"$it\"/>") }
                body.append("</w:pPr>")
                for (r in p.runs) {
                    body.append("<w:r><w:rPr>")
                    if (r.bold) body.append("<w:b/>")
                    if (r.italic) body.append("<w:i/>")
                    r.sizePt?.let { body.append("<w:sz w:val=\"${(it * 2).toInt().coerceIn(8, 144)}\"/>") }
                    body.append("</w:rPr><w:t xml:space=\"preserve\">").append(xml(r.text)).append("</w:t></w:r>")
                }
                body.append("</w:p>")
            }
            z.text("word/document.xml", XML_HEAD +
                "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><w:body>" +
                body + "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr>" +
                "</w:body></w:document>")
        }
    }

    private fun heading(id: String, name: String, halfPoints: Int) =
        "<w:style w:type=\"paragraph\" w:styleId=\"$id\"><w:name w:val=\"$name\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/>" +
            "<w:pPr><w:keepNext/><w:spacing w:before=\"240\" w:after=\"120\"/><w:outlineLvl w:val=\"${if (id == "Heading2") 1 else 0}\"/></w:pPr>" +
            "<w:rPr><w:b/><w:color w:val=\"1F2A5A\"/><w:sz w:val=\"$halfPoints\"/></w:rPr></w:style>"
}

// ============================================================================================
// XLSX
// ============================================================================================

data class Sheet(val name: String, val rows: List<List<String>>)

object XlsxWriter {
    private val numberRegex = Regex("^-?[0-9]{1,3}([   ]?[0-9]{3})*([.,][0-9]+)?$|^-?[0-9]+([.,][0-9]+)?$")

    /** Convertit « 1 234,56 », « 12.5 », « 45 % » ou « 10 € » en nombre si possible. */
    fun asNumber(raw: String): Double? {
        var s = raw.trim().removeSuffix("€").removeSuffix("%").removePrefix("€").removePrefix("$").trim()
        if (s.isEmpty() || !numberRegex.matches(s)) return null
        s = s.replace(" ", "").replace(" ", "").replace(" ", "")
        if (s.count { it == ',' } == 1 && !s.contains('.')) s = s.replace(',', '.')
        return s.toDoubleOrNull()
    }

    fun write(sheets: List<Sheet>, output: File) {
        val list = sheets.ifEmpty { listOf(Sheet("Feuille 1", emptyList())) }
        ZipWriter(output).use { z ->
            val overrides = list.indices.joinToString("") {
                "<Override PartName=\"/xl/worksheets/sheet${it + 1}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
            }
            z.text("[Content_Types].xml", XML_HEAD +
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
                overrides + "</Types>")
            z.text("_rels/.rels", XML_HEAD +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>")
            val sheetsXml = list.mapIndexed { i, s ->
                "<sheet name=\"${xml(safeSheetName(s.name, i))}\" sheetId=\"${i + 1}\" r:id=\"rId${i + 1}\"/>"
            }.joinToString("")
            z.text("xl/workbook.xml", XML_HEAD +
                "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
                "<sheets>$sheetsXml</sheets></workbook>")
            val rels = list.indices.joinToString("") {
                "<Relationship Id=\"rId${it + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet${it + 1}.xml\"/>"
            } + "<Relationship Id=\"rId${list.size + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
            z.text("xl/_rels/workbook.xml.rels", XML_HEAD + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">$rels</Relationships>")
            z.text("xl/styles.xml", XML_HEAD +
                "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
                "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>" +
                "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>" +
                "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>" +
                "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
                "<cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs>" +
                "</styleSheet>")
            list.forEachIndexed { i, s -> z.text("xl/worksheets/sheet${i + 1}.xml", sheetXml(s)) }
        }
    }

    private fun safeSheetName(name: String, i: Int): String =
        name.replace(Regex("[\\[\\]:*?/\\\\]"), " ").take(31).ifBlank { "Feuille ${i + 1}" }

    fun columnName(index: Int): String {
        var n = index + 1; val sb = StringBuilder()
        while (n > 0) { val r = (n - 1) % 26; sb.insert(0, ('A' + r)); n = (n - 1) / 26 }
        return sb.toString()
    }

    private fun sheetXml(s: Sheet): String {
        val maxCols = s.rows.maxOfOrNull { it.size } ?: 0
        val widths = (0 until maxCols).map { c -> (s.rows.maxOfOrNull { it.getOrNull(c)?.length ?: 0 } ?: 8).coerceIn(8, 60) + 2 }
        val sb = StringBuilder(XML_HEAD)
        sb.append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">")
        if (maxCols > 0) {
            sb.append("<cols>")
            widths.forEachIndexed { i, w -> sb.append("<col min=\"${i + 1}\" max=\"${i + 1}\" width=\"$w\" customWidth=\"1\"/>") }
            sb.append("</cols>")
        }
        sb.append("<sheetData>")
        s.rows.forEachIndexed { r, row ->
            sb.append("<row r=\"${r + 1}\">")
            row.forEachIndexed { c, value ->
                if (value.isEmpty()) return@forEachIndexed
                val ref = columnName(c) + (r + 1)
                val num = asNumber(value)
                val style = if (r == 0) " s=\"1\"" else ""
                if (num != null) sb.append("<c r=\"$ref\"$style><v>$num</v></c>")
                else sb.append("<c r=\"$ref\" t=\"inlineStr\"$style><is><t xml:space=\"preserve\">${xml(value)}</t></is></c>")
            }
            sb.append("</row>")
        }
        sb.append("</sheetData></worksheet>")
        return sb.toString()
    }
}

// ============================================================================================
// PPTX
// ============================================================================================

/** Diapositive : une image plein cadre et/ou des zones de texte positionnées (en EMU). */
data class Slide(val imageJpeg: ByteArray? = null, val texts: List<SlideText> = emptyList())
data class SlideText(val text: String, val x: Long, val y: Long, val cx: Long, val cy: Long, val sizePt: Float, val bold: Boolean)

object PptxWriter {
    const val EMU_PER_PT = 12700L

    fun write(slides: List<Slide>, widthPt: Float, heightPt: Float, output: File) {
        val cx = (widthPt * EMU_PER_PT).toLong().coerceAtLeast(914400)
        val cy = (heightPt * EMU_PER_PT).toLong().coerceAtLeast(914400)
        ZipWriter(output).use { z ->
            val slideOverrides = slides.indices.joinToString("") {
                "<Override PartName=\"/ppt/slides/slide${it + 1}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"
            }
            z.text("[Content_Types].xml", XML_HEAD +
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>" +
                "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>" +
                "<Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>" +
                "<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>" +
                "<Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>" +
                slideOverrides + "</Types>")
            z.text("_rels/.rels", XML_HEAD +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/></Relationships>")
            val sldIds = slides.indices.joinToString("") { "<p:sldId id=\"${256 + it}\" r:id=\"rId${it + 2}\"/>" }
            z.text("ppt/presentation.xml", XML_HEAD +
                "<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">" +
                "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>" +
                "<p:sldIdLst>$sldIds</p:sldIdLst><p:sldSz cx=\"$cx\" cy=\"$cy\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/></p:presentation>")
            val presRels = "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>" +
                slides.indices.joinToString("") { "<Relationship Id=\"rId${it + 2}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide${it + 1}.xml\"/>" } +
                "<Relationship Id=\"rId${slides.size + 2}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"theme/theme1.xml\"/>"
            z.text("ppt/_rels/presentation.xml.rels", XML_HEAD + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">$presRels</Relationships>")
            z.text("ppt/slideMasters/slideMaster1.xml", XML_HEAD +
                "<p:sldMaster xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">" +
                "<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>" +
                "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>" +
                "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst></p:sldMaster>")
            z.text("ppt/slideMasters/_rels/slideMaster1.xml.rels", XML_HEAD +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>" +
                "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"../theme/theme1.xml\"/></Relationships>")
            z.text("ppt/slideLayouts/slideLayout1.xml", XML_HEAD +
                "<p:sldLayout xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" type=\"blank\">" +
                "<p:cSld name=\"Vide\"><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>" +
                "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>")
            z.text("ppt/slideLayouts/_rels/slideLayout1.xml.rels", XML_HEAD +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/></Relationships>")
            z.text("ppt/theme/theme1.xml", THEME)
            slides.forEachIndexed { i, s ->
                val n = i + 1
                val shapes = StringBuilder()
                var id = 2
                if (s.imageJpeg != null) {
                    z.bytes("ppt/media/image$n.jpeg", s.imageJpeg)
                    shapes.append("<p:pic><p:nvPicPr><p:cNvPr id=\"${id++}\" name=\"Page $n\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>" +
                        "<p:blipFill><a:blip r:embed=\"rId2\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>" +
                        "<p:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"$cx\" cy=\"$cy\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>")
                }
                for (t in s.texts) {
                    shapes.append("<p:sp><p:nvSpPr><p:cNvPr id=\"${id++}\" name=\"Texte $id\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr>" +
                        "<p:spPr><a:xfrm><a:off x=\"${t.x}\" y=\"${t.y}\"/><a:ext cx=\"${t.cx}\" cy=\"${t.cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>" +
                        "<p:txBody><a:bodyPr wrap=\"none\" lIns=\"0\" tIns=\"0\" rIns=\"0\" bIns=\"0\"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r>" +
                        "<a:rPr lang=\"fr-FR\" sz=\"${(t.sizePt * 100).toInt().coerceIn(100, 40000)}\"${if (t.bold) " b=\"1\"" else ""} dirty=\"0\"/>" +
                        "<a:t>${xml(t.text)}</a:t></a:r></a:p></p:txBody></p:sp>")
                }
                z.text("ppt/slides/slide$n.xml", XML_HEAD +
                    "<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">" +
                    "<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>$shapes</p:spTree></p:cSld>" +
                    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")
                val img = if (s.imageJpeg != null) "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image$n.jpeg\"/>" else ""
                z.text("ppt/slides/_rels/slide$n.xml.rels", XML_HEAD +
                    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>$img</Relationships>")
            }
        }
    }

    private val THEME = XML_HEAD +
        "<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Pagio\"><a:themeElements>" +
        "<a:clrScheme name=\"Pagio\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1>" +
        "<a:dk2><a:srgbClr val=\"1F2A5A\"/></a:dk2><a:lt2><a:srgbClr val=\"EEF0F8\"/></a:lt2><a:accent1><a:srgbClr val=\"5B4BDB\"/></a:accent1>" +
        "<a:accent2><a:srgbClr val=\"FF6B57\"/></a:accent2><a:accent3><a:srgbClr val=\"22A06B\"/></a:accent3><a:accent4><a:srgbClr val=\"F5A524\"/></a:accent4>" +
        "<a:accent5><a:srgbClr val=\"2E90FA\"/></a:accent5><a:accent6><a:srgbClr val=\"9B51E0\"/></a:accent6><a:hlink><a:srgbClr val=\"2E90FA\"/></a:hlink>" +
        "<a:folHlink><a:srgbClr val=\"9B51E0\"/></a:folHlink></a:clrScheme>" +
        "<a:fontScheme name=\"Pagio\"><a:majorFont><a:latin typeface=\"Calibri Light\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont>" +
        "<a:minorFont><a:latin typeface=\"Calibri\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme>" +
        "<a:fmtScheme name=\"Pagio\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>" +
        "<a:lnStyleLst><a:ln w=\"6350\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"19050\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln></a:lnStyleLst>" +
        "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
        "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>" +
        "</a:fmtScheme></a:themeElements></a:theme>"
}
