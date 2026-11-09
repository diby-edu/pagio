package com.pagio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.pagio.engine.office.OfficeToPdf
import com.pagio.engine.office.PdfToOffice
import com.tom_roush.pdfbox.pdmodel.PDDocument
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipFile

/**
 * Tests réels du moteur sur un appareil Android : chaque outil produit un fichier qui est
 * ensuite relu et contrôlé (nombre de pages, texte, chiffrement, signatures…).
 */
@RunWith(AndroidJUnit4::class)
class EngineInstrumentedTest {
    private lateinit var dir: File

    @Before fun setUp() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        PagioEngine.init(ctx)
        dir = File(ctx.cacheDir, "engine-tests").apply { deleteRecursively(); mkdirs() }
    }

    /** PDF de test avec exactement [pages] pages de texte (une section par page). */
    private fun textPdf(name: String, pages: Int, prefix: String = "Page"): File {
        val parts = (1..pages).map { p ->
            val f = File(dir, "${name}_part$p.pdf")
            PdfCreate.textToPdf("$prefix $p : " + "Pagio test contenu lorem ipsum dolor sit amet. ".repeat(20), TextPdfOptions(fontSize = 11f, title = "Document $name"), f)
            f
        }
        val f = File(dir, "$name.pdf")
        if (parts.size == 1) parts[0].copyTo(f, overwrite = true) else PdfPages.merge(parts, f)
        return f
    }

    private fun pages(f: File) = PDDocument.load(f).use { it.numberOfPages }
    private fun text(f: File, pw: String? = null) = PdfText.extractText(f, pw)

    private fun photo(name: String, w: Int = 1600, h: Int = 1200): File {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp); c.drawColor(Color.rgb(240, 240, 250))
        val p = Paint().apply { color = Color.rgb(91, 75, 219); isAntiAlias = true }
        for (i in 0 until 40) { p.color = Color.rgb((i * 37) % 255, (i * 91) % 255, (i * 53) % 255); c.drawCircle((i * 97 % w).toFloat(), (i * 53 % h).toFloat(), 120f, p) }
        val f = File(dir, "$name.jpg"); FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        return f
    }

    @Test fun textToPdfCreatesSearchablePages() {
        val f = textPdf("txt", 3)
        assertEquals(3, pages(f))
                assertTrue(text(f).contains("Pagio test contenu"))
    }

    @Test fun mergeKeepsAllPagesInOrder() {
        val a = textPdf("a", 2, "Alpha"); val b = textPdf("b", 3, "Beta")
        val out = PdfPages.merge(listOf(a, b), File(dir, "merged.pdf"))
        assertEquals(pages(a) + pages(b), pages(out))
        val t = text(out)
        assertTrue(t.indexOf("Alpha") < t.indexOf("Beta"))
    }

    @Test fun splitByRangesEveryPageAndSize() {
        val src = textPdf("split", 6)
        val n = pages(src)
        val parts = PdfPages.splitByRanges(src, PageRanges.parse("1-2, 4-", n), File(dir, "parts"))
        assertEquals(2, parts.size); assertEquals(2, pages(parts[0])); assertEquals(n - 3, pages(parts[1]))
        assertEquals(n, PdfPages.extractAll(src, File(dir, "every")).size)
        val bySize = PdfPages.splitBySize(src, src.length() / 2, File(dir, "size"))
        assertTrue(bySize.size >= 2)
        assertEquals(n, bySize.sumOf { pages(it) })
    }

    @Test fun extractDeleteRotateOrganize() {
        val src = textPdf("org", 5); val n = pages(src)
        assertEquals(2, pages(PdfPages.extractPages(src, listOf(3, 1), File(dir, "ex.pdf"))))
        assertEquals(n - 2, pages(PdfPages.deletePages(src, setOf(1, 2), File(dir, "del.pdf"))))
        val rot = PdfPages.rotate(src, 90, setOf(1), File(dir, "rot.pdf"))
        PDDocument.load(rot).use { assertEquals(90, it.getPage(0).rotation); assertEquals(0, it.getPage(1).rotation) }
        val organized = PdfPages.organize(src, listOf(PageSpec(2), PageSpec(0, 180), PageSpec(0), PageSpec(-1)), File(dir, "organized.pdf"))
        PDDocument.load(organized).use { d ->
            assertEquals(4, d.numberOfPages)
            assertEquals(180, d.getPage(1).rotation)
            assertEquals(0, d.getPage(2).rotation) // le doublon garde sa propre rotation
        }
        assertThrows(EngineException::class.java) { PdfPages.deletePages(src, (1..n).toSet(), File(dir, "none.pdf")) }
    }

    @Test fun imagesToPdfAndCompressionShrinksPhotos() {
        val imgs = listOf(photo("p1"), photo("p2", 1200, 1600))
        val pdf = PdfCreate.imagesToPdf(imgs, ImagePdfOptions(jpegQuality = 0.95f), File(dir, "photos.pdf"))
        assertEquals(2, pages(pdf))
        PDDocument.load(pdf).use { assertTrue(it.getPage(0).mediaBox.width > it.getPage(0).mediaBox.height) } // paysage automatique
        val r = PdfOptimize.compress(pdf, CompressionLevel.EXTREME, File(dir, "small.pdf"))
        assertTrue("taille ${r.originalBytes} -> ${r.newBytes}", r.newBytes < r.originalBytes)
        assertEquals(2, pages(r.output))
    }

    @Test fun protectThenUnlock() {
        val src = textPdf("secret", 1)
        val locked = PdfSecurity.protect(src, ProtectOptions("motdepasse"), File(dir, "locked.pdf"))
        assertTrue(PdfSecurity.isEncrypted(locked))
        val e = assertThrows(EngineException::class.java) { openPdf(locked) }
        assertEquals(EngineError.PASSWORD_REQUIRED, e.code)
        assertEquals(EngineError.WRONG_PASSWORD, assertThrows(EngineException::class.java) { openPdf(locked, "faux") }.code)
        val open = PdfSecurity.unlock(locked, "motdepasse", File(dir, "open.pdf"))
        assertFalse(PdfSecurity.isEncrypted(open))
        assertTrue(text(open).contains("Pagio"))
    }

    @Test fun stampsAddVisibleText() {
        val src = textPdf("stamp", 3)
        val n = pages(src)
        val numbered = PdfStamps.pageNumbers(src, PageNumberOptions(format = "Page {n} sur {p}"), File(dir, "num.pdf"))
        assertTrue(text(numbered).contains("Page 2 sur $n"))
        val wm = PdfStamps.watermark(src, WatermarkOptions(text = "CONFIDENTIEL", mosaic = true, rotationDeg = 0f), File(dir, "wm.pdf"))
        assertTrue(text(wm).contains("CONFIDENTIEL"))
        val hf = PdfStamps.headerFooter(src, HeaderFooterOptions(headerLeft = "Rapport annuel", footerRight = "{n}/{p}"), File(dir, "hf.pdf"))
        val t = text(hf); assertTrue(t.contains("Rapport annuel")); assertTrue(t.contains("1/$n"))
    }

    @Test fun metadataEditAndStrip() {
        val src = textPdf("meta", 1)
        val edited = PdfSecurity.writeMetadata(src, PdfMetadata(title = "Contrat", author = "Awa Diallo", keywords = "client"), File(dir, "meta.pdf"))
        val m = PdfSecurity.readMetadata(edited)
        assertEquals("Contrat", m.title); assertEquals("Awa Diallo", m.author)
        val clean = PdfSecurity.stripMetadata(edited, File(dir, "clean.pdf"))
        val m2 = PdfSecurity.readMetadata(clean)
        assertEquals(null, m2.author); assertEquals(null, m2.title)
    }

    @Test fun digitalSignatureIsValidAndDetectsTampering() {
        val src = textPdf("tosign", 1)
        val id = SigningIdentity.createSelfSigned("Awa Diallo", "awa@example.com", File(dir, "id.p12"), "pw".toCharArray())
        val signed = PdfSecurity.signDigitally(src, id, File(dir, "signed.pdf"), "Awa Diallo", "Accord", "Dakar")
        val checks = PdfSecurity.verifySignatures(signed)
        assertEquals(1, checks.size); assertTrue(checks[0].integrityValid); assertTrue(checks[0].coversWholeDocument); assertTrue(checks[0].selfSigned)
        // Altération d'un octet du contenu signé : la signature doit devenir invalide.
        val bytes = signed.readBytes(); val i = (src.length() / 2).toInt(); bytes[i] = (bytes[i] + 1).toByte()
        val tampered = File(dir, "tampered.pdf").apply { writeBytes(bytes) }
        val t = runCatching { PdfSecurity.verifySignatures(tampered) }.getOrNull()
        assertTrue(t == null || !t[0].integrityValid)
        // Rechargement du certificat enregistré.
        assertEquals(id.subject, SigningIdentity.load(File(dir, "id.p12"), "pw".toCharArray()).subject)
    }

    @Test fun editorAppliesAllElementKinds() {
        val src = textPdf("edit", 1)
        val sig = photo("sig", 300, 120)
        val out = PdfEditor.apply(src, listOf(
            EditElement.Text(0, 0.1f, 0.55f, "Texte ajouté é à ç", 16f, "#E5484D", bold = true),
            EditElement.Image(0, 0.6f, 0.8f, 0.3f, 0.1f, sig),
            EditElement.Shape(0, EditElement.ShapeKind.ARROW, 0.1f, 0.5f, 0.4f, 0.6f),
            EditElement.Shape(0, EditElement.ShapeKind.ELLIPSE, 0.5f, 0.5f, 0.7f, 0.6f, fillHex = "#FFEB3B"),
            EditElement.Markup(0, EditElement.MarkupKind.HIGHLIGHT, 0.1f, 0.2f, 0.5f, 0.02f),
            EditElement.Markup(0, EditElement.MarkupKind.STRIKEOUT, 0.1f, 0.25f, 0.5f, 0.02f),
            EditElement.Ink(0, listOf(listOf(0.1f to 0.7f, 0.2f to 0.75f, 0.3f to 0.7f))),
            EditElement.Note(0, 0.9f, 0.05f, "À vérifier"),
            EditElement.Check(0, 0.1f, 0.9f, 14f, true, fillable = true, name = "accord"),
            EditElement.Field(0, 0.3f, 0.9f, 0.3f, 0.03f, "nom", value = "Awa"),
            EditElement.Whiteout(0, 0.0f, 0.95f, 0.2f, 0.03f),
        ), File(dir, "edited.pdf"))
        android.util.Log.i("PAGIO_TEST", "editor text = " + text(out).take(400).replace('\n', '|'))
        assertTrue(text(out).contains("Texte ajouté"))
        PDDocument.load(out).use { d -> assertTrue(d.getPage(0).annotations.any { it.subtype == "Text" }) }
        val fields = PdfEditor.listFields(out)
        assertTrue(fields.any { it.name == "accord" && it.type == "checkbox" && it.value == "true" })
        assertTrue(fields.any { it.name == "nom" && it.value == "Awa" })
        val filled = PdfEditor.fillFields(out, mapOf("nom" to "Koffi", "accord" to "false"), false, File(dir, "filled.pdf"))
        val f2 = PdfEditor.listFields(filled)
        assertEquals("Koffi", f2.first { it.name == "nom" }.value)
        assertEquals("false", f2.first { it.name == "accord" }.value)
        val flat = PdfEditor.fillFields(out, mapOf("nom" to "Figé"), true, File(dir, "flat.pdf"))
        assertTrue(PdfEditor.listFields(flat).isEmpty())
    }

    @Test fun replaceAndRedact() {
        val src = File(dir, "letter.pdf")
        PdfCreate.textToPdf("Madame Dupont,\nVotre numéro client est 778899.\nContact : jean@example.com", TextPdfOptions(), src)
        val replaced = File(dir, "replaced.pdf")
        assertEquals(1, PdfEditor.replaceText(src, "778899", "112233", replaced))
        // Le nouveau texte est bien écrit dans la page (l'ancien reste recouvert, d'où la biffure pour le supprimer).
        val content = PDDocument.load(replaced).use { d -> d.getPage(0).contents.use { String(it.readBytes(), Charsets.ISO_8859_1) } }
        assertTrue(content.contains("112233") || content.contains("313132323333"))
        val layout = PdfText.layout(src)
        val word = layout[0].lines.flatMap { it.words }.first { it.text.contains("jean@") }
        val redacted = PdfEditor.redact(src, mapOf(0 to listOf(floatArrayOf(word.x, word.y, word.w, word.h))), File(dir, "redacted.pdf"))
        assertFalse(text(redacted).contains("jean@example.com")) // le texte a réellement disparu
        assertEquals(1, pages(redacted))
    }

    @Test fun invisibleOcrLayerMakesScanSearchable() {
        val scan = PdfCreate.imagesToPdf(listOf(photo("scan")), ImagePdfOptions(), File(dir, "scan.pdf"))
        assertTrue(text(scan).isBlank())
        val out = PdfText.addInvisibleTextLayer(scan, mapOf(0 to listOf(OcrLine("Bonjour le monde", 0.1f, 0.1f, 0.6f, 0.15f))), File(dir, "scan_ocr.pdf"))
        assertTrue(text(out).contains("Bonjour le monde"))
        assertEquals(1, PdfText.search(out, "monde").size)
    }

    @Test fun pdfToImagesAndExtractImages() {
        val src = textPdf("img", 2)
        val imgs = PdfRender.toImages(src, File(dir, "imgs"), ImageFormat.PNG, 72)
        assertEquals(pages(src), imgs.size)
        assertTrue(imgs.all { it.length() > 1000 })
        val photos = PdfCreate.imagesToPdf(listOf(photo("x")), ImagePdfOptions(), File(dir, "withimg.pdf"))
        assertEquals(1, PdfRender.extractImages(photos, File(dir, "extracted"), ImageFormat.JPG).size)
    }

    @Test fun repairRewritesDamagedFile() {
        val src = textPdf("broken", 2)
        // Supprime la table des références (fin de fichier) : l'analyseur tolérant doit reconstruire.
        val bytes = src.readBytes()
        val cut = String(bytes, Charsets.ISO_8859_1).lastIndexOf("xref")
        val damaged = File(dir, "damaged.pdf").apply { writeBytes(bytes.copyOf(cut)) }
        val report = PdfOptimize.repair(damaged, File(dir, "repaired.pdf"))
        assertEquals(pages(src), report.pageCount)
        assertTrue(text(report.output).contains("Pagio"))
    }

    @Test fun officeRoundTrips() {
        val src = textPdf("office", 2)
        val docx = PdfToOffice.toDocx(src, File(dir, "out.docx"))
        ZipFile(docx).use { z -> assertTrue(String(z.getInputStream(z.getEntry("word/document.xml")).readBytes()).contains("Pagio test contenu")) }
        val backFromWord = OfficeToPdf.convert(docx, File(dir, "fromdocx.pdf"))
        assertTrue(text(backFromWord).contains("Pagio test contenu"))

        val xlsx = PdfToOffice.toXlsx(src, File(dir, "out.xlsx"), sheetPerPage = true)
        ZipFile(xlsx).use { z -> assertTrue(z.getEntry("xl/worksheets/sheet2.xml") != null) }
        assertTrue(text(OfficeToPdf.convert(xlsx, File(dir, "fromxlsx.pdf"))).contains("Pagio"))

        val pptx = PdfToOffice.toPptx(src, File(dir, "out.pptx"), PdfToOffice.PptMode.IMAGE)
        ZipFile(pptx).use { z -> assertTrue(z.getEntry("ppt/slides/slide2.xml") != null); assertTrue(z.getEntry("ppt/media/image1.jpeg") != null) }
        val pptText = PdfToOffice.toPptx(src, File(dir, "out_text.pptx"), PdfToOffice.PptMode.EDITABLE_TEXT)
        assertTrue(text(OfficeToPdf.convert(pptText, File(dir, "fromppt.pdf"))).contains("Pagio"))
    }

    @Test fun blankDocumentWithPattern() {
        val f = PdfCreate.blankPdf(BlankPdfOptions(pages = 3, pattern = "grid", orientation = Orientation.LANDSCAPE), File(dir, "blank.pdf"))
        PDDocument.load(f).use { assertEquals(3, it.numberOfPages); assertTrue(it.getPage(0).mediaBox.width > it.getPage(0).mediaBox.height) }
    }

    @Test fun tablesAreRebuiltFromPositions() {
        val f = File(dir, "table.pdf")
        PDDocument().use { d ->
            val page = com.tom_roush.pdfbox.pdmodel.PDPage(); d.addPage(page)
            com.tom_roush.pdfbox.pdmodel.PDPageContentStream(d, page).use { cs ->
                cs.setFont(com.tom_roush.pdfbox.pdmodel.font.PDType1Font.HELVETICA, 11f)
                listOf(listOf("Produit", "Qte", "Prix"), listOf("Stylo", "3", "4,50"), listOf("Cahier", "10", "12,00")).forEachIndexed { r, row ->
                    row.forEachIndexed { c, cell -> cs.beginText(); cs.newLineAtOffset(60f + c * 160f, 700f - r * 20f); cs.showText(cell); cs.endText() }
                }
            }
            d.save(f)
        }
        val rows = PdfText.tables(PdfText.layout(f))[0]
        assertEquals(listOf("Produit", "Qte", "Prix"), rows[0])
        assertEquals(listOf("Cahier", "10", "12,00"), rows[2])
    }
}
