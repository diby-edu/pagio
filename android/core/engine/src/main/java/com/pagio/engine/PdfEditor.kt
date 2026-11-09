package com.pagio.engine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.PDResources
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDColor
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceRGB
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationText
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceCharacteristicsDictionary
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceDictionary
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceStream
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDBorderStyleDictionary
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDAcroForm
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDCheckBox
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDChoice
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDField
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDRadioButton
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDSignatureField
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDTextField
import java.io.File
import java.util.Calendar

/**
 * Éléments ajoutés par l'éditeur. Coordonnées normalisées (0..1) sur la page telle qu'affichée,
 * origine en haut à gauche — exactement ce que voit l'utilisateur à l'écran.
 */
sealed class EditElement {
    abstract val page: Int

    data class Text(override val page: Int, val x: Float, val y: Float, val text: String, val sizePt: Float = 14f,
                    val colorHex: String = "#111111", val bold: Boolean = false, val italic: Boolean = false,
                    val family: String = "sans") : EditElement()

    data class Image(override val page: Int, val x: Float, val y: Float, val w: Float, val h: Float, val file: File) : EditElement()

    enum class ShapeKind { RECTANGLE, ELLIPSE, LINE, ARROW }
    data class Shape(override val page: Int, val kind: ShapeKind, val x1: Float, val y1: Float, val x2: Float, val y2: Float,
                     val strokeHex: String = "#E53935", val fillHex: String? = null, val widthPt: Float = 2f) : EditElement()

    enum class MarkupKind { HIGHLIGHT, UNDERLINE, STRIKEOUT }
    data class Markup(override val page: Int, val kind: MarkupKind, val x: Float, val y: Float, val w: Float, val h: Float,
                      val colorHex: String = "#FFEB3B") : EditElement()

    data class Ink(override val page: Int, val strokes: List<List<Pair<Float, Float>>>, val colorHex: String = "#1E3A8A", val widthPt: Float = 2f) : EditElement()

    data class Note(override val page: Int, val x: Float, val y: Float, val text: String, val author: String = "Pagio") : EditElement()

    data class Check(override val page: Int, val x: Float, val y: Float, val sizePt: Float = 14f, val checked: Boolean = true,
                     val fillable: Boolean = false, val name: String = "") : EditElement()

    enum class FieldKind { TEXT, DATE, MULTILINE }
    data class Field(override val page: Int, val x: Float, val y: Float, val w: Float, val h: Float, val name: String,
                     val kind: FieldKind = FieldKind.TEXT, val value: String = "") : EditElement()

    data class Whiteout(override val page: Int, val x: Float, val y: Float, val w: Float, val h: Float, val colorHex: String = "#FFFFFF") : EditElement()
}

data class FormFieldInfo(val name: String, val type: String, val value: String, val options: List<String>, val readOnly: Boolean)

object PdfEditor {

    fun apply(input: File, elements: List<EditElement>, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): File =
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val fonts = FontKit(doc)
            val byPage = elements.groupBy { it.page }
            byPage.entries.forEachIndexed { i, (pageIndex, items) ->
                ctx.progress(i.toFloat() / byPage.size, "Page ${pageIndex + 1}")
                val page = doc.getPage(pageIndex)
                val flat = items.filter { it !is EditElement.Note && !(it is EditElement.Check && it.fillable) && it !is EditElement.Field }
                if (flat.isNotEmpty()) doc.drawOnPage(page) { cs, space -> flat.forEach { draw(doc, cs, space, fonts, it) } }
                items.filterIsInstance<EditElement.Note>().forEach { addNote(doc, page, it) }
                items.filterIsInstance<EditElement.Check>().filter { it.fillable }.forEach { addCheckField(doc, page, it) }
                items.filterIsInstance<EditElement.Field>().forEach { addTextField(doc, page, it) }
            }
            doc.save(output); output
        }

    private fun draw(doc: PDDocument, cs: PDPageContentStream, s: PageSpace, fonts: FontKit, e: EditElement) {
        fun px(nx: Float) = nx * s.width
        fun py(ny: Float) = (1f - ny) * s.height
        when (e) {
            is EditElement.Text -> {
                val font = fonts.font(e.text, e.bold, e.italic, e.family)
                val c = parseColor(e.colorHex)
                cs.setNonStrokingColor(c[0], c[1], c[2])
                var y = py(e.y) - e.sizePt
                for (line in e.text.split('\n')) {
                    cs.beginText(); cs.setFont(font, e.sizePt); cs.newLineAtOffset(px(e.x), y)
                    cs.showText(fonts.safeText(font, line)); cs.endText()
                    y -= e.sizePt * 1.25f
                }
            }
            is EditElement.Image -> {
                val bmp = BitmapFactory.decodeFile(e.file.absolutePath)
                    ?: throw EngineException(EngineError.UNSUPPORTED_FORMAT, "Image illisible : ${e.file.name}")
                val img = if (bmp.hasAlpha()) LosslessFactory.createFromImage(doc, bmp) else JPEGFactory.createFromImage(doc, bmp, 0.9f)
                cs.drawImage(img, px(e.x), py(e.y + e.h), e.w * s.width, e.h * s.height)
            }
            is EditElement.Shape -> {
                val c = parseColor(e.strokeHex)
                cs.setStrokingColor(c[0], c[1], c[2]); cs.setLineWidth(e.widthPt)
                e.fillHex?.let { val f = parseColor(it); cs.setNonStrokingColor(f[0], f[1], f[2]) }
                val x1 = px(minOf(e.x1, e.x2)); val x2 = px(maxOf(e.x1, e.x2))
                val y1 = py(maxOf(e.y1, e.y2)); val y2 = py(minOf(e.y1, e.y2))
                when (e.kind) {
                    EditElement.ShapeKind.RECTANGLE -> { cs.addRect(x1, y1, x2 - x1, y2 - y1); if (e.fillHex != null) cs.fillAndStroke() else cs.stroke() }
                    EditElement.ShapeKind.ELLIPSE -> { ellipse(cs, (x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2); if (e.fillHex != null) cs.fillAndStroke() else cs.stroke() }
                    EditElement.ShapeKind.LINE, EditElement.ShapeKind.ARROW -> {
                        val ax = px(e.x1); val ay = py(e.y1); val bx = px(e.x2); val by = py(e.y2)
                        cs.moveTo(ax, ay); cs.lineTo(bx, by); cs.stroke()
                        if (e.kind == EditElement.ShapeKind.ARROW) {
                            val angle = Math.atan2((by - ay).toDouble(), (bx - ax).toDouble())
                            val len = 6f + e.widthPt * 3
                            for (d in listOf(Math.PI * 0.85, -Math.PI * 0.85)) {
                                cs.moveTo(bx, by)
                                cs.lineTo((bx + len * Math.cos(angle + d)).toFloat(), (by + len * Math.sin(angle + d)).toFloat())
                            }
                            cs.stroke()
                        }
                    }
                }
            }
            is EditElement.Markup -> {
                val c = parseColor(e.colorHex)
                val x = px(e.x); val w = e.w * s.width; val top = py(e.y); val h = e.h * s.height
                when (e.kind) {
                    EditElement.MarkupKind.HIGHLIGHT -> {
                        cs.saveGraphicsState()
                        cs.setGraphicsStateParameters(PDExtendedGraphicsState().apply { nonStrokingAlphaConstant = 0.38f })
                        cs.setNonStrokingColor(c[0], c[1], c[2]); cs.addRect(x, top - h, w, h); cs.fill()
                        cs.restoreGraphicsState()
                    }
                    EditElement.MarkupKind.UNDERLINE -> { cs.setStrokingColor(c[0], c[1], c[2]); cs.setLineWidth(maxOf(1f, h * 0.08f)); cs.moveTo(x, top - h); cs.lineTo(x + w, top - h); cs.stroke() }
                    EditElement.MarkupKind.STRIKEOUT -> { cs.setStrokingColor(c[0], c[1], c[2]); cs.setLineWidth(maxOf(1f, h * 0.08f)); cs.moveTo(x, top - h / 2); cs.lineTo(x + w, top - h / 2); cs.stroke() }
                }
            }
            is EditElement.Ink -> {
                val c = parseColor(e.colorHex)
                cs.setStrokingColor(c[0], c[1], c[2]); cs.setLineWidth(e.widthPt)
                cs.setLineCapStyle(1); cs.setLineJoinStyle(1)
                for (stroke in e.strokes) {
                    if (stroke.isEmpty()) continue
                    cs.moveTo(px(stroke[0].first), py(stroke[0].second))
                    if (stroke.size == 1) cs.lineTo(px(stroke[0].first) + 0.1f, py(stroke[0].second))
                    for (p in stroke.drop(1)) cs.lineTo(px(p.first), py(p.second))
                    cs.stroke()
                }
            }
            is EditElement.Check -> {
                val x = px(e.x); val top = py(e.y); val sz = e.sizePt
                cs.setStrokingColor(0.15f, 0.15f, 0.2f); cs.setLineWidth(1f)
                cs.addRect(x, top - sz, sz, sz); cs.stroke()
                if (e.checked) { checkMark(cs, x, top - sz, sz) }
            }
            is EditElement.Whiteout -> {
                val c = parseColor(e.colorHex)
                cs.setNonStrokingColor(c[0], c[1], c[2]); cs.addRect(px(e.x), py(e.y + e.h), e.w * s.width, e.h * s.height); cs.fill()
            }
            is EditElement.Note, is EditElement.Field -> Unit
        }
    }

    private fun checkMark(cs: PDPageContentStream, x: Float, y: Float, sz: Float) {
        cs.setStrokingColor(0.10f, 0.45f, 0.20f); cs.setLineWidth(sz * 0.14f)
        cs.moveTo(x + sz * 0.2f, y + sz * 0.5f); cs.lineTo(x + sz * 0.42f, y + sz * 0.25f); cs.lineTo(x + sz * 0.82f, y + sz * 0.8f); cs.stroke()
    }

    private fun ellipse(cs: PDPageContentStream, cx: Float, cy: Float, rx: Float, ry: Float) {
        val k = 0.5522848f
        cs.moveTo(cx - rx, cy)
        cs.curveTo(cx - rx, cy + k * ry, cx - k * rx, cy + ry, cx, cy + ry)
        cs.curveTo(cx + k * rx, cy + ry, cx + rx, cy + k * ry, cx + rx, cy)
        cs.curveTo(cx + rx, cy - k * ry, cx + k * rx, cy - ry, cx, cy - ry)
        cs.curveTo(cx - k * rx, cy - ry, cx - rx, cy - k * ry, cx - rx, cy)
        cs.closePath()
    }

    /** Rectangle PDF (espace utilisateur) correspondant à une zone normalisée affichée. */
    private fun userRect(page: PDPage, x: Float, y: Float, w: Float, h: Float): PDRectangle {
        val s = PageSpace(page)
        val (ax, ay) = s.toUser(x * s.width, (1 - y) * s.height)
        val (bx, by) = s.toUser((x + w) * s.width, (1 - y - h) * s.height)
        return PDRectangle(minOf(ax, bx), minOf(ay, by), kotlin.math.abs(bx - ax), kotlin.math.abs(by - ay))
    }

    /** Commentaire (note) : vraie annotation PDF avec une icône visible dans tous les lecteurs. */
    private fun addNote(doc: PDDocument, page: PDPage, n: EditElement.Note) {
        val rect = userRect(page, n.x, n.y, 22f / PageSpace(page).width, 22f / PageSpace(page).height)
        val note = PDAnnotationText().apply {
            rectangle = rect
            contents = n.text
            titlePopup = n.author
            color = PDColor(floatArrayOf(1f, 0.85f, 0.2f), PDDeviceRGB.INSTANCE)
            setModifiedDate(Calendar.getInstance())
            isPrinted = true
        }
        val ap = PDAppearanceStream(doc).apply { bBox = PDRectangle(rect.width, rect.height); resources = PDResources() }
        PDPageContentStream(doc, ap).use { cs ->
            cs.setNonStrokingColor(1f, 0.83f, 0.25f); cs.setStrokingColor(0.55f, 0.42f, 0f); cs.setLineWidth(1f)
            cs.addRect(0.5f, 0.5f, rect.width - 1, rect.height - 1); cs.fillAndStroke()
            for (k in 1..3) { val y = rect.height * (0.25f * k); cs.moveTo(rect.width * 0.2f, y); cs.lineTo(rect.width * 0.8f, y) }
            cs.stroke()
        }
        note.appearance = PDAppearanceDictionary().apply { setNormalAppearance(ap) }
        page.annotations = (page.annotations + note).toMutableList()
    }

    private fun acroForm(doc: PDDocument): PDAcroForm {
        val catalog = doc.documentCatalog
        val form = catalog.acroForm ?: PDAcroForm(doc).also { catalog.acroForm = it }
        if (form.defaultResources == null) form.defaultResources = PDResources()
        form.defaultResources.put(COSName.getPDFName("Helv"), PDType1Font.HELVETICA)
        if (form.defaultAppearance.isNullOrEmpty()) form.defaultAppearance = "/Helv 0 Tf 0 g"
        return form
    }

    private fun uniqueName(form: PDAcroForm, base: String): String {
        val clean = base.ifBlank { "champ" }.replace('.', '_')
        var name = clean; var i = 2
        while (form.getField(name) != null) { name = "${clean}_$i"; i++ }
        return name
    }

    /** Champ texte remplissable (ou date pré-remplie). */
    private fun addTextField(doc: PDDocument, page: PDPage, f: EditElement.Field) {
        val form = acroForm(doc)
        val field = PDTextField(form)
        field.partialName = uniqueName(form, f.name)
        field.defaultAppearance = "/Helv 0 Tf 0 0 0.4 rg"
        if (f.kind == EditElement.FieldKind.MULTILINE) field.isMultiline = true
        val widget = field.widgets.first()
        widget.rectangle = userRect(page, f.x, f.y, f.w, f.h)
        widget.page = page
        widget.isPrinted = true
        widget.appearanceCharacteristics = PDAppearanceCharacteristicsDictionary(COSDictionary()).apply {
            borderColour = PDColor(floatArrayOf(0.36f, 0.33f, 0.85f), PDDeviceRGB.INSTANCE)
            background = PDColor(floatArrayOf(0.96f, 0.96f, 1f), PDDeviceRGB.INSTANCE)
        }
        widget.borderStyle = PDBorderStyleDictionary().apply { width = 1f }
        page.annotations = (page.annotations + widget).toMutableList()
        form.fields.add(field)
        val value = if (f.kind == EditElement.FieldKind.DATE && f.value.isBlank())
            java.text.SimpleDateFormat("dd/MM/yyyy", java.util.Locale.FRANCE).format(java.util.Date()) else f.value
        runCatching { field.value = value }
    }

    /** Case à cocher remplissable, avec ses apparences cochée / non cochée. */
    private fun addCheckField(doc: PDDocument, page: PDPage, c: EditElement.Check) {
        val form = acroForm(doc)
        val box = PDCheckBox(form)
        box.partialName = uniqueName(form, c.name.ifBlank { "case" })
        val space = PageSpace(page)
        val rect = userRect(page, c.x, c.y, c.sizePt / space.width, c.sizePt / space.height)
        val widget = box.widgets.first()
        widget.rectangle = rect; widget.page = page; widget.isPrinted = true
        fun stream(checked: Boolean) = PDAppearanceStream(doc).apply {
            bBox = PDRectangle(rect.width, rect.height); resources = PDResources()
        }.also { ap ->
            PDPageContentStream(doc, ap).use { cs ->
                cs.setNonStrokingColor(1f); cs.setStrokingColor(0.15f, 0.15f, 0.2f); cs.setLineWidth(1f)
                cs.addRect(0.5f, 0.5f, rect.width - 1, rect.height - 1); cs.fillAndStroke()
                if (checked) checkMark(cs, 0f, 0f, minOf(rect.width, rect.height))
            }
        }
        val normal = COSDictionary()
        normal.setItem(COSName.getPDFName("Yes"), stream(true))
        normal.setItem(COSName.Off, stream(false))
        val apDict = PDAppearanceDictionary()
        apDict.cosObject.setItem(COSName.N, normal)
        widget.appearance = apDict
        widget.setAppearanceState(if (c.checked) "Yes" else "Off")
        page.annotations = (page.annotations + widget).toMutableList()
        form.fields.add(box)
        box.cosObject.setItem(COSName.V, if (c.checked) COSName.getPDFName("Yes") else COSName.Off)
    }

    // --- Formulaires existants -------------------------------------------------------------

    fun listFields(input: File, password: String? = null): List<FormFieldInfo> = input.usePdf(password) { doc ->
        val form = doc.documentCatalog.acroForm ?: return@usePdf emptyList()
        form.fieldTree.filter { it.widgets.isNotEmpty() || it is PDTextField }.mapNotNull { f -> info(f) }
    }

    private fun info(f: PDField): FormFieldInfo? = when (f) {
        is PDSignatureField -> null
        is PDCheckBox -> FormFieldInfo(f.fullyQualifiedName, "checkbox", if (f.isChecked) "true" else "false", emptyList(), f.isReadOnly)
        is PDRadioButton -> FormFieldInfo(f.fullyQualifiedName, "radio", f.valueAsString ?: "", f.exportValues ?: emptyList(), f.isReadOnly)
        is PDChoice -> FormFieldInfo(f.fullyQualifiedName, "choice", f.value.firstOrNull() ?: "", f.optionsDisplayValues, f.isReadOnly)
        is PDTextField -> FormFieldInfo(f.fullyQualifiedName, "text", f.value ?: "", emptyList(), f.isReadOnly)
        else -> null
    }

    /** Remplit les champs ; [flatten] fige les valeurs dans la page (formulaire non modifiable). */
    fun fillFields(input: File, values: Map<String, String>, flatten: Boolean, output: File, password: String? = null): File =
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val form = doc.documentCatalog.acroForm ?: throw EngineException(EngineError.EMPTY_INPUT, "Ce PDF ne contient pas de formulaire")
            if (form.defaultResources == null) form.defaultResources = PDResources()
            form.defaultResources.put(COSName.getPDFName("Helv"), PDType1Font.HELVETICA)
            for ((name, value) in values) {
                val f = form.getField(name) ?: continue
                runCatching {
                    when (f) {
                        is PDCheckBox -> if (value == "true") f.check() else f.unCheck()
                        is PDRadioButton -> f.value = value
                        is PDChoice -> f.setValue(value)
                        is PDTextField -> f.value = value
                        else -> f.setValue(value)
                    }
                }
            }
            if (flatten) runCatching { form.flatten() } else form.needAppearances = false
            doc.save(output); output
        }

    // --- Remplacement de texte et biffure ----------------------------------------------------

    /**
     * Remplace un texte visible : la zone d'origine est recouverte puis le nouveau texte est écrit
     * à la même position et à une taille proche. Le texte d'origine reste dans le fichier :
     * pour le faire disparaître définitivement, utilisez la biffure.
     */
    fun replaceText(input: File, search: String, replacement: String, output: File, password: String? = null): Int {
        if (search.isBlank()) throw EngineException(EngineError.EMPTY_INPUT, "Saisissez le texte à rechercher")
        var count = 0
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val edits = mutableListOf<EditElement>()
            for (i in 0 until doc.numberOfPages) {
                val layout = PdfText.pageLayout(doc, i)
                for (line in layout.lines) {
                    val ws = line.words
                    // Plus petite fenêtre de mots contenant le texte cherché : on ne recouvre que ce qui change.
                    var b = 0
                    while (b < ws.size) {
                        var a = b
                        var found = -1
                        while (a >= 0 && b - a < 12) {
                            if (ws.subList(a, b + 1).joinToString(" ") { it.text }.contains(search)) { found = a; break }
                            a--
                        }
                        if (found < 0) { b++; continue }
                        val span = ws.subList(found, b + 1)
                        val joined = span.joinToString(" ") { it.text }
                        val first = span.first(); val last = span.last()
                        val x = first.x; val y = span.minOf { it.y }
                        val w = last.x + last.w - x; val h = span.maxOf { it.y + it.h } - y
                        edits += EditElement.Whiteout(i, x - 0.002f, y - 0.002f, w + 0.004f, h + 0.004f)
                        val size = first.fontSize.takeIf { it in 4f..72f } ?: (h * layout.height * 0.9f)
                        // Ligne de base alignée sur celle du texte d'origine (bas de la boîte du mot).
                        edits += EditElement.Text(i, x, y + h - size / layout.height, joined.replace(search, replacement), size, "#000000", first.bold, first.italic)
                        count++
                        b++
                    }
                }
            }
            if (count == 0) return 0
            val fixed = edits
            val tmp = File(output.parentFile, "tmp_replace_${System.nanoTime()}.pdf")
            doc.save(tmp)
            apply(tmp, fixed, output)
            tmp.delete()
        }
        return count
    }

    /**
     * Biffure définitive : chaque page concernée est re-rendue en image avec les zones noircies,
     * puis remplace la page d'origine. Le texte caché est réellement supprimé du fichier.
     */
    fun redact(input: File, zones: Map<Int, List<FloatArray>>, output: File, dpi: Int = 200, ctx: TaskContext = TaskContext.NONE): File {
        val images = HashMap<Int, Bitmap>()
        val pfd = ParcelFileDescriptor.open(input, ParcelFileDescriptor.MODE_READ_ONLY)
        PdfRenderer(pfd).use { r ->
            for ((index, rects) in zones) {
                ctx.progress(0.6f * images.size / zones.size, "Biffure page ${index + 1}")
                val page = r.openPage(index)
                val bmp = try { PdfRender.render(page, dpi / 72f) } finally { page.close() }
                val canvas = Canvas(bmp)
                val paint = Paint().apply { color = android.graphics.Color.BLACK }
                for (z in rects) canvas.drawRect(z[0] * bmp.width, z[1] * bmp.height, (z[0] + z[2]) * bmp.width, (z[1] + z[3]) * bmp.height, paint)
                images[index] = bmp
            }
        }
        input.usePdf { doc ->
            for ((index, bmp) in images) {
                val old = doc.getPage(index)
                val space = PageSpace(old)
                val newPage = PDPage(PDRectangle(space.width, space.height))
                val img = JPEGFactory.createFromImage(doc, bmp, 0.92f)
                PDPageContentStream(doc, newPage).use { it.drawImage(img, 0f, 0f, space.width, space.height) }
                doc.pages.insertBefore(newPage, old)
                doc.removePage(old)
                bmp.recycle()
            }
            doc.documentCatalog.metadata = null
            ctx.progress(0.95f, "Enregistrement…")
            doc.save(output)
        }
        return output
    }
}
