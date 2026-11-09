package com.pagio.app.tools

import android.graphics.Bitmap
import com.pagio.app.AppContainer
import com.pagio.app.ServerState
import com.pagio.app.data.PickedFile
import com.pagio.app.data.humanSize
import com.pagio.engine.Anchor
import com.pagio.engine.CompressionLevel
import com.pagio.engine.EditElement
import com.pagio.engine.EngineError
import com.pagio.engine.EngineException
import com.pagio.engine.HeaderFooterOptions
import com.pagio.engine.ImageFormat
import com.pagio.engine.ImagePdfOptions
import com.pagio.engine.Orientation
import com.pagio.engine.OcrLine
import com.pagio.engine.PageNumberOptions
import com.pagio.engine.PageRanges
import com.pagio.engine.PageSize
import com.pagio.engine.PdfCreate
import com.pagio.engine.PdfEditor
import com.pagio.engine.PdfOptimize
import com.pagio.engine.PdfPages
import com.pagio.engine.PdfRender
import com.pagio.engine.PdfSecurity
import com.pagio.engine.PdfStamps
import com.pagio.engine.PdfText
import com.pagio.engine.ProtectOptions
import com.pagio.engine.SigningIdentity
import com.pagio.engine.TaskContext
import com.pagio.engine.TextPdfOptions
import com.pagio.engine.BlankPdfOptions
import com.pagio.engine.WatermarkOptions
import com.pagio.engine.baseName
import com.pagio.engine.office.OfficeToPdf
import com.pagio.engine.office.PdfToOffice
import com.pagio.engine.office.Sheet
import com.pagio.engine.office.XlsxWriter
import com.pagio.engine.outputFile
import kotlinx.coroutines.runBlocking
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale

/** Toutes les options réglables, avec des valeurs par défaut sensées. */
data class ToolOptions(
    // Division / pages
    val splitMode: String = "ranges",          // ranges, fixed, every, size
    val ranges: String = "",
    val fixedSize: Int = 1,
    val maxSizeMb: Float = 5f,
    val mergeRanges: Boolean = false,
    val rotation: Int = 90,
    // Compression
    val compression: CompressionLevel = CompressionLevel.RECOMMENDED,
    // Images → PDF
    val pageSize: PageSize = PageSize.A4,
    val orientation: Orientation = Orientation.AUTO,
    val marginPt: Float = 0f,
    // Conversions
    val useServer: Boolean = false,
    val sheetPerPage: Boolean = false,
    val pptEditable: Boolean = false,
    val imageFormat: ImageFormat = ImageFormat.JPG,
    val dpi: Int = 150,
    val textFontSize: Float = 11f,
    val monospace: Boolean = false,
    val htmlUrl: String = "",
    // Création
    val blankPages: Int = 1,
    val blankPattern: String = "blank",
    val blankColor: String = "#FFFFFF",
    // Numéros de page
    val pnAnchor: Anchor = Anchor.BOTTOM_CENTER,
    val pnFormat: String = "{n}",
    val pnFirst: Int = 1,
    val pnFacing: Boolean = false,
    val fontSize: Float = 11f,
    // Filigrane
    val wmText: String = "CONFIDENTIEL",
    val wmImage: PickedFile? = null,
    val wmAnchor: Anchor = Anchor.CENTER,
    val wmMosaic: Boolean = false,
    val wmOpacity: Float = 0.25f,
    val wmRotation: Float = 45f,
    val wmSize: Float = 48f,
    val wmColor: String = "#E5484D",
    val wmBehind: Boolean = false,
    // En-tête / pied
    val hf: HeaderFooterOptions = HeaderFooterOptions(footerCenter = "Page {n} / {p}", headerRight = "{date}"),
    // Remplacer / biffer
    val search: String = "",
    val replacement: String = "",
    val redactTerms: String = "",
    val redactEmails: Boolean = false,
    val redactPhones: Boolean = false,
    val redactIbans: Boolean = false,
    // Sécurité
    val password: String = "",
    val passwordConfirm: String = "",
    val allowPrint: Boolean = true,
    val allowCopy: Boolean = false,
    val allowModify: Boolean = false,
    val metaTitle: String = "",
    val metaAuthor: String = "",
    val metaSubject: String = "",
    val metaKeywords: String = "",
    val metaLoaded: Boolean = false,
    val signerName: String = "",
    val signReason: String = "Approbation du document",
    val signLocation: String = "",
    val certificate: PickedFile? = null,
    val certificatePassword: String = "",
    // OCR
    val ocrAlsoTxt: Boolean = true,
    val ocrForce: Boolean = false,
)

/** Résultat présenté à l'utilisateur. */
data class ToolResult(val tool: Tool, val outputs: List<File>, val summary: String, val report: String? = null)

class ToolInputException(message: String) : Exception(message)

/**
 * Exécute un outil sur les fichiers choisis. Tout est fait sur l'appareil, sauf les conversions
 * Office explicitement confiées au serveur (option « Haute fidélité »).
 */
class ToolRunner(private val app: AppContainer) {

    suspend fun validate(tool: Tool, files: List<PickedFile>, o: ToolOptions) {
        if (tool.input != InputKind.NONE && files.size < tool.minFiles && tool != Tool.HTML_TO_PDF) {
            throw ToolInputException(if (tool.minFiles > 1) "Ajoutez au moins ${tool.minFiles} fichiers." else "Choisissez un fichier pour commencer.")
        }
        if (tool == Tool.HTML_TO_PDF && files.isEmpty() && o.htmlUrl.isBlank()) throw ToolInputException("Choisissez un fichier HTML ou saisissez une adresse web.")
        val cfg = app.config.value
        val flag = cfg.tool(tool.id)
        if (!flag.enabled) throw ToolInputException("Cet outil est temporairement désactivé par l'administrateur.")
        val premium = app.account.value?.isPremium == true
        if (flag.premium && !premium) throw ToolInputException("Cet outil est réservé à l'offre Premium. Connectez-vous avec un compte Premium.")
        val limits = if (premium) cfg.premiumLimits else cfg.freeLimits
        val maxFiles = flag.maxFiles.takeIf { it > 0 } ?: limits.maxFiles
        if (maxFiles > 0 && files.size > maxFiles) throw ToolInputException("Votre offre permet $maxFiles fichier(s) maximum pour cet outil.")
        val maxMb = flag.maxMb.takeIf { it > 0 } ?: limits.maxMb
        if (maxMb > 0) files.firstOrNull { it.size > maxMb * 1024L * 1024 }?.let {
            throw ToolInputException("« ${it.displayName} » dépasse la taille autorisée ($maxMb Mo).")
        }
        if (limits.dailyTasks > 0 && app.settings.tasksToday() >= limits.dailyTasks) {
            throw ToolInputException("Vous avez utilisé vos ${limits.dailyTasks} tâches gratuites du jour. Elles seront renouvelées demain.")
        }
        when (tool) {
            Tool.PROTECT -> {
                if (o.password.length < 4) throw ToolInputException("Le mot de passe doit contenir au moins 4 caractères.")
                if (o.password != o.passwordConfirm) throw ToolInputException("Les deux mots de passe ne correspondent pas.")
            }
            Tool.UNLOCK -> if (o.password.isBlank() && files.firstOrNull()?.password.isNullOrBlank()) throw ToolInputException("Saisissez le mot de passe du document.")
            Tool.WATERMARK -> if (o.wmText.isBlank() && o.wmImage == null) throw ToolInputException("Saisissez un texte ou choisissez une image.")
            Tool.REPLACE_TEXT -> if (o.search.isBlank()) throw ToolInputException("Saisissez le texte à remplacer.")
            Tool.REDACT -> if (o.redactTerms.isBlank() && !o.redactEmails && !o.redactPhones && !o.redactIbans) throw ToolInputException("Indiquez ce qu'il faut biffer.")
            Tool.OFFICE_TO_PDF -> if (!o.useServer) files.firstOrNull { !OfficeToPdf.supported(it.file) }?.let {
                throw ToolInputException("« ${it.displayName} » est un ancien format : activez « Haute fidélité (serveur) » pour le convertir.")
            }
            else -> Unit
        }
    }

    suspend fun run(tool: Tool, files: List<PickedFile>, o: ToolOptions, ctx: TaskContext): ToolResult {
        val out = app.workspace.newOutputDir()
        val first = files.firstOrNull()
        val pdf = first?.file
        val pw = first?.password
        fun single(ext: String, suffix: String) = outputFile(out, "${first!!.displayName.substringBeforeLast('.')}_$suffix", ext)

        val result: ToolResult = when (tool) {
            Tool.MERGE -> {
                val f = PdfPages.merge(files.map { it.file }, outputFile(out, "fusion_${stamp()}", "pdf"), ctx, files.filter { it.password != null }.associate { it.file to it.password!! })
                ToolResult(tool, listOf(f), "${files.size} fichiers fusionnés · ${PdfPages.pageCount(f)} pages")
            }
            Tool.SPLIT -> {
                val n = PdfPages.pageCount(pdf!!, pw)
                val list = when (o.splitMode) {
                    "every" -> PdfPages.extractAll(pdf, out, ctx, pw)
                    "fixed" -> PdfPages.splitByRanges(pdf, PageRanges.fixed(o.fixedSize.coerceAtLeast(1), n), out, false, ctx, pw)
                    "size" -> PdfPages.splitBySize(pdf, (o.maxSizeMb * 1024 * 1024).toLong(), out, ctx, pw)
                    else -> PdfPages.splitByRanges(pdf, PageRanges.parse(o.ranges, n), out, o.mergeRanges, ctx, pw)
                }
                ToolResult(tool, list, "${list.size} fichier(s) créé(s) à partir de $n pages")
            }
            Tool.EXTRACT_PAGES -> {
                val n = PdfPages.pageCount(pdf!!, pw)
                val pages = PageRanges.pages(o.ranges.ifBlank { throw ToolInputException("Indiquez les pages à extraire (ex. 1-3, 5).") }, n)
                ToolResult(tool, listOf(PdfPages.extractPages(pdf, pages, single("pdf", "extrait"), pw)), "${pages.size} page(s) extraite(s)")
            }
            Tool.DELETE_PAGES -> {
                val n = PdfPages.pageCount(pdf!!, pw)
                val pages = PageRanges.pages(o.ranges.ifBlank { throw ToolInputException("Indiquez les pages à supprimer (ex. 2, 4-6).") }, n).toSet()
                ToolResult(tool, listOf(PdfPages.deletePages(pdf, pages, single("pdf", "modifie"), pw)), "${pages.size} page(s) supprimée(s) · ${n - pages.size} restante(s)")
            }
            Tool.ROTATE -> {
                val list = files.mapIndexed { i, f ->
                    ctx.progress(i.toFloat() / files.size)
                    val n = PdfPages.pageCount(f.file, f.password)
                    val pages = if (o.ranges.isBlank()) null else PageRanges.pages(o.ranges, n).toSet()
                    PdfPages.rotate(f.file, o.rotation, pages, outputFile(out, f.displayName.substringBeforeLast('.') + "_pivote", "pdf"), f.password)
                }
                ToolResult(tool, list, "Rotation de ${o.rotation}° appliquée")
            }
            Tool.COMPRESS -> {
                var before = 0L; var after = 0L
                val list = files.mapIndexed { i, f ->
                    val sub = TaskContext({ p, m -> ctx.progress((i + p) / files.size, m) })
                    val r = PdfOptimize.compress(f.file, o.compression, outputFile(out, f.displayName.substringBeforeLast('.') + "_compresse", "pdf"), sub, f.password)
                    before += r.originalBytes; after += r.newBytes; r.output
                }
                val pct = if (before > 0) (100 - after * 100 / before) else 0
                ToolResult(tool, list, if (pct > 0) "${before.humanSize()} → ${after.humanSize()} (−$pct %)" else "Fichier déjà optimisé : taille conservée (${after.humanSize()})")
            }
            Tool.REPAIR -> {
                val reports = files.map { f -> PdfOptimize.repair(f.file, outputFile(out, f.displayName.substringBeforeLast('.') + "_repare", "pdf"), ctx, f.password) }
                val removed = reports.sumOf { it.removedPages.size }
                ToolResult(tool, reports.map { it.output }, if (removed == 0) "Document reconstruit sans perte" else "$removed page(s) irrécupérable(s) retirée(s)")
            }
            Tool.OCR -> runOcr(pdf!!, pw, o, out, ctx, first.displayName)
            Tool.EXTRACT_TEXT -> {
                val text = documentText(first!!, ctx)
                val f = single("txt", "texte"); f.writeText(text)
                ToolResult(tool, listOf(f), "${text.length} caractères extraits", report = text.take(4000))
            }
            Tool.IMAGES_TO_PDF -> {
                val f = PdfCreate.imagesToPdf(files.map { it.file }, ImagePdfOptions(o.pageSize, o.orientation, o.marginPt), outputFile(out, "images_${stamp()}", "pdf"), ctx)
                ToolResult(tool, listOf(f), "${files.size} image(s) → ${PdfPages.pageCount(f)} page(s)")
            }
            Tool.OFFICE_TO_PDF -> {
                val list = files.mapIndexed { i, f ->
                    ctx.progress(i.toFloat() / files.size, "Conversion de « ${f.displayName} »")
                    val target = outputFile(out, f.displayName.substringBeforeLast('.'), "pdf")
                    if (o.useServer) serverConvert(f.file, "pdf", target, ctx) else OfficeToPdf.convert(f.file, target, ctx)
                }
                ToolResult(tool, list, if (o.useServer) "Converti par le serveur (haute fidélité)" else "Converti sur l'appareil")
            }
            Tool.HTML_TO_PDF -> throw IllegalStateException("géré par l'écran (WebView)")
            Tool.TXT_TO_PDF -> {
                val list = files.map { f ->
                    PdfCreate.textToPdf(f.file.readText(), TextPdfOptions(o.pageSize.takeIf { it != PageSize.FIT } ?: PageSize.A4, o.textFontSize, monospace = o.monospace),
                        outputFile(out, f.displayName.substringBeforeLast('.'), "pdf"), ctx)
                }
                ToolResult(tool, list, "${list.size} fichier(s) texte converti(s)")
            }
            Tool.CREATE_PDF -> {
                val f = PdfCreate.blankPdf(BlankPdfOptions(o.pageSize.takeIf { it != PageSize.FIT } ?: PageSize.A4,
                    if (o.orientation == Orientation.LANDSCAPE) Orientation.LANDSCAPE else Orientation.PORTRAIT, o.blankPages, o.blankColor, o.blankPattern),
                    outputFile(out, "nouveau_document_${stamp()}", "pdf"))
                ToolResult(tool, listOf(f), "Document de ${o.blankPages} page(s) créé")
            }
            Tool.PDF_TO_WORD -> {
                val target = single("docx", "word")
                val f = if (o.useServer) serverConvert(pdf!!, "docx", target, ctx) else PdfToOffice.toDocx(pdf!!, target, ctx, pw)
                ToolResult(tool, listOf(f), "Document Word créé")
            }
            Tool.PDF_TO_EXCEL -> ToolResult(tool, listOf(PdfToOffice.toXlsx(pdf!!, single("xlsx", "excel"), o.sheetPerPage, ctx, pw)),
                if (o.sheetPerPage) "Une feuille par page" else "Une seule feuille")
            Tool.PDF_TO_PPT -> ToolResult(tool, listOf(PdfToOffice.toPptx(pdf!!, single("pptx", "powerpoint"),
                if (o.pptEditable) PdfToOffice.PptMode.EDITABLE_TEXT else PdfToOffice.PptMode.IMAGE, ctx, pw)), "Présentation créée")
            Tool.PDF_TO_IMAGES -> {
                val src = decrypted(first!!, out)
                val n = PdfPages.pageCount(src)
                val pages = if (o.ranges.isBlank()) null else PageRanges.pages(o.ranges, n)
                val list = PdfRender.toImages(src, out, o.imageFormat, o.dpi, pages, ctx = ctx)
                ToolResult(tool, list, "${list.size} image(s) ${o.imageFormat.ext.uppercase()} à ${o.dpi} ppp")
            }
            Tool.EXTRACT_IMAGES -> {
                val list = PdfRender.extractImages(pdf!!, out, o.imageFormat, pw, ctx)
                ToolResult(tool, list, "${list.size} image(s) extraite(s)")
            }
            Tool.PAGE_NUMBERS -> {
                val list = files.map { f ->
                    PdfStamps.pageNumbers(f.file, PageNumberOptions(o.pnAnchor, o.pnFormat, o.pnFirst, o.ranges, o.fontSize, facingPages = o.pnFacing),
                        outputFile(out, f.displayName.substringBeforeLast('.') + "_numerote", "pdf"), ctx, f.password)
                }
                ToolResult(tool, list, "Numéros de page ajoutés")
            }
            Tool.WATERMARK -> {
                val list = files.map { f ->
                    PdfStamps.watermark(f.file, WatermarkOptions(o.wmText.ifBlank { null }, o.wmImage?.file, o.wmAnchor, o.wmMosaic, o.wmOpacity, o.wmRotation,
                        o.wmSize, o.wmColor, pages = o.ranges, behindContent = o.wmBehind), outputFile(out, f.displayName.substringBeforeLast('.') + "_filigrane", "pdf"), ctx, f.password)
                }
                ToolResult(tool, list, "Filigrane appliqué")
            }
            Tool.HEADER_FOOTER -> {
                val list = files.map { f ->
                    PdfStamps.headerFooter(f.file, o.hf.copy(pages = o.ranges, fileName = f.displayName.substringBeforeLast('.')),
                        outputFile(out, f.displayName.substringBeforeLast('.') + "_entete", "pdf"), ctx, f.password)
                }
                ToolResult(tool, list, "En-têtes et pieds de page ajoutés")
            }
            Tool.REPLACE_TEXT -> {
                val target = single("pdf", "modifie")
                val count = PdfEditor.replaceText(pdf!!, o.search, o.replacement, target, pw)
                if (count == 0) throw ToolInputException("« ${o.search} » n'a pas été trouvé dans le texte du document.")
                ToolResult(tool, listOf(target), "$count occurrence(s) remplacée(s)",
                    report = "Le texte visible a été remplacé. Le texte d'origine reste présent sous le recouvrement : pour le supprimer définitivement, utilisez « Biffer ».")
            }
            Tool.REDACT -> runRedact(first!!, o, out, ctx)
            Tool.PROTECT -> ToolResult(tool, listOf(PdfSecurity.protect(pdf!!, ProtectOptions(o.password, null, o.allowPrint, o.allowCopy, o.allowModify), single("pdf", "protege"), pw)),
                "Protégé par mot de passe (AES-256)")
            Tool.UNLOCK -> ToolResult(tool, listOf(PdfSecurity.unlock(pdf!!, o.password.ifBlank { pw ?: "" }, single("pdf", "deverrouille"))), "Mot de passe retiré")
            Tool.METADATA -> {
                val meta = PdfSecurity.readMetadata(pdf!!, pw)
                val f = PdfSecurity.writeMetadata(pdf, meta.copy(title = o.metaTitle, author = o.metaAuthor, subject = o.metaSubject, keywords = o.metaKeywords), single("pdf", "proprietes"), pw)
                ToolResult(tool, listOf(f), "Propriétés mises à jour", report = metadataReport(meta))
            }
            Tool.STRIP_METADATA -> {
                val list = files.map { f -> PdfSecurity.stripMetadata(f.file, outputFile(out, f.displayName.substringBeforeLast('.') + "_anonyme", "pdf"), f.password) }
                ToolResult(tool, list, "Métadonnées, scripts et pièces jointes cachées supprimés")
            }
            Tool.DIGITAL_SIGN -> {
                val identity = identity(o)
                val f = PdfSecurity.signDigitally(pdf!!, identity, single("pdf", "signe"), o.signerName.ifBlank { null }, o.signReason.ifBlank { null }, o.signLocation.ifBlank { null }, pw)
                ToolResult(tool, listOf(f), "Signé numériquement par ${identity.chain.first().subjectX500Principal.name.substringAfter("CN=").substringBefore(',')}")
            }
            Tool.VERIFY_SIGN -> {
                val checks = PdfSecurity.verifySignatures(pdf!!, pw)
                val fmt = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.FRANCE)
                val report = checks.mapIndexed { i, c ->
                    "Signature ${i + 1} — ${if (c.integrityValid) "✔ valide" else "✘ invalide"}\n" +
                        "Signataire : ${c.signerName ?: c.certificateSubject ?: "inconnu"}\n" +
                        (c.signDate?.let { "Date : ${fmt.format(it)}\n" } ?: "") +
                        (c.reason?.let { "Motif : $it\n" } ?: "") +
                        "Certificat : ${c.certificateSubject ?: "—"}\nÉmetteur : ${c.certificateIssuer ?: "—"}\n${c.message}"
                }.joinToString("\n\n")
                ToolResult(tool, emptyList(), "${checks.count { it.integrityValid }}/${checks.size} signature(s) valide(s)", report)
            }
            Tool.TABLES -> {
                val pages = PdfText.layout(pdf!!, pw, ctx)
                val tables = PdfText.tables(pages)
                if (tables.all { it.isEmpty() }) throw EngineException(EngineError.NO_TEXT, "Aucun tableau ni texte trouvé : lancez d'abord l'OCR sur ce document scanné.")
                val xlsx = single("xlsx", "tableaux")
                XlsxWriter.write(tables.mapIndexedNotNull { i, rows -> if (rows.isEmpty()) null else Sheet("Page ${i + 1}", rows) }, xlsx)
                val csv = single("csv", "tableaux")
                csv.writeText(tables.flatten().joinToString("\n") { row -> row.joinToString(";") { "\"" + it.replace("\"", "\"\"") + "\"" } })
                ToolResult(tool, listOf(xlsx, csv), "${tables.sumOf { it.size }} ligne(s) extraite(s) en Excel et CSV")
            }
            else -> throw IllegalStateException("Outil ${tool.id} géré par un écran dédié")
        }
        if (app.config.value.freeLimits.dailyTasks > 0) app.settings.incrementTasks()
        return result
    }

    /** Pour le rendu, un PDF chiffré est d'abord déverrouillé dans le dossier temporaire. */
    fun decrypted(f: PickedFile, dir: File): File {
        if (f.password.isNullOrEmpty()) return f.file
        val tmp = File(app.workspace.newTaskDir(), "dec_${f.file.name}")
        return PdfSecurity.unlock(f.file, f.password!!, tmp)
    }

    private fun stamp() = SimpleDateFormat("yyyyMMdd_HHmm", Locale.ROOT).format(java.util.Date())

    private suspend fun serverConvert(input: File, target: String, output: File, ctx: TaskContext): File {
        if (app.server.value != ServerState.ONLINE) throw ToolInputException("Serveur de conversion injoignable. Désactivez « Haute fidélité » pour convertir sur l'appareil.")
        if (!app.config.value.serverConversion) throw ToolInputException("La conversion haute fidélité n'est pas activée sur le serveur.")
        ctx.progress(0.05f, "Envoi sécurisé au serveur…")
        return app.backend.convert(input, target, output) { ctx.progress(it, if (it < 0.7f) "Envoi…" else "Conversion…") }
    }

    /** Texte d'un document : couche texte du PDF, ou OCR si la page est une image. */
    suspend fun documentText(f: PickedFile, ctx: TaskContext): String {
        if (f.isImage) {
            val bmp = PdfCreate.loadBitmap(f.file, 3000) ?: throw ToolInputException("Image illisible")
            return app.ocr.recognize(bmp).text
        }
        if (!f.isPdf) return f.file.readText()
        val pages = PdfText.extractPages(f.file, f.password, ctx)
        if (pages.sumOf { it.length } >= 30 * pages.size) return pages.mapIndexed { i, t -> "[Page ${i + 1}]\n$t" }.joinToString("\n\n")
        // Document scanné : OCR page par page.
        val src = decrypted(f, app.workspace.newTaskDir())
        val sb = StringBuilder()
        PdfRender.open(src) { r ->
            for (i in 0 until r.pageCount) {
                ctx.progress(i.toFloat() / r.pageCount, "Reconnaissance du texte, page ${i + 1}/${r.pageCount}")
                val page = r.openPage(i)
                val bmp: Bitmap = try { PdfRender.render(page, 2.4f) } finally { page.close() }
                val text = app.ocr.recognize(bmp).text
                bmp.recycle()
                sb.append("[Page ${i + 1}]\n").append(text).append("\n\n")
            }
        }
        return sb.toString()
    }

    private suspend fun runOcr(pdf: File, pw: String?, o: ToolOptions, out: File, ctx: TaskContext, name: String): ToolResult {
        val src = if (pw.isNullOrEmpty()) pdf else PdfSecurity.unlock(pdf, pw, File(app.workspace.newTaskDir(), "dec.pdf"))
        val existing = PdfText.extractPages(src)
        val pagesOcr = HashMap<Int, List<OcrLine>>()
        val text = StringBuilder()
        var skipped = 0
        PdfRender.open(src) { r ->
            for (i in 0 until r.pageCount) {
                ctx.progress(0.9f * i / r.pageCount, "Reconnaissance du texte, page ${i + 1}/${r.pageCount}")
                if (!o.ocrForce && existing.getOrNull(i)?.length ?: 0 > 50) { skipped++; text.append(existing[i]).append("\n\n"); continue }
                val page = r.openPage(i)
                val bmp = try { PdfRender.render(page, 300f / 72f) } finally { page.close() }
                val res = app.ocr.recognize(bmp)
                bmp.recycle()
                pagesOcr[i] = res.lines.map { OcrLine(it.text, it.left, it.top, it.right, it.bottom) }
                text.append(res.text).append("\n\n")
            }
        }
        val base = name.substringBeforeLast('.')
        val outputs = mutableListOf<File>()
        val searchable = outputFile(out, "${base}_ocr", "pdf")
        PdfText.addInvisibleTextLayer(src, pagesOcr, searchable, ctx)
        outputs += searchable
        if (o.ocrAlsoTxt) outputs += outputFile(out, "${base}_texte", "txt").also { it.writeText(text.toString()) }
        val lang = runCatching { app.languages.detect(text.toString()) }.getOrNull()
        return ToolResult(Tool.OCR, outputs,
            "${pagesOcr.size} page(s) reconnue(s)" + (if (skipped > 0) ", $skipped déjà lisible(s)" else "") + " · langue : ${com.pagio.ai.LanguageDetector.displayName(lang)}",
            report = text.toString().take(3000))
    }

    private fun runRedact(f: PickedFile, o: ToolOptions, out: File, ctx: TaskContext): ToolResult {
        val src = decrypted(f, out)
        val patterns = mutableListOf<Regex>()
        o.redactTerms.split(',', '\n').map { it.trim() }.filter { it.isNotEmpty() }.forEach { patterns += Regex(Regex.escape(it), RegexOption.IGNORE_CASE) }
        if (o.redactEmails) patterns += Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")
        if (o.redactPhones) patterns += Regex("(?:\\+\\d{1,3})?\\d{6,}")
        if (o.redactIbans) patterns += Regex("[A-Z]{2}\\d{2}[A-Z0-9]{4,}")
        val zones = HashMap<Int, MutableList<FloatArray>>()
        var count = 0
        val layout = PdfText.layout(src)
        for (page in layout) for (line in page.lines) {
            val text = line.text
            for (p in patterns) for (m in p.findAll(text)) {
                // Position approximative des caractères trouvés : mots couverts par la correspondance.
                var pos = 0
                val covered = line.words.filter { w ->
                    val start = text.indexOf(w.text, pos).also { if (it >= 0) pos = it + w.text.length }
                    start >= 0 && start < m.range.last + 1 && start + w.text.length > m.range.first
                }
                if (covered.isEmpty()) continue
                val x = covered.minOf { it.x }; val y = covered.minOf { it.y }
                val r = covered.maxOf { it.x + it.w }; val b = covered.maxOf { it.y + it.h }
                zones.getOrPut(page.index) { mutableListOf() } += floatArrayOf(x - 0.003f, y - 0.003f, r - x + 0.006f, b - y + 0.006f)
                count++
            }
        }
        if (count == 0) throw ToolInputException("Aucune correspondance trouvée dans le texte. Pour un document scanné, lancez d'abord l'OCR.")
        val target = outputFile(out, f.displayName.substringBeforeLast('.') + "_biffe", "pdf")
        PdfEditor.redact(src, zones, target, ctx = ctx)
        return ToolResult(Tool.REDACT, listOf(target), "$count zone(s) biffée(s) sur ${zones.size} page(s)",
            report = "Les pages concernées ont été converties en image : le texte masqué est définitivement supprimé du fichier.")
    }

    private suspend fun identity(o: ToolOptions): SigningIdentity {
        o.certificate?.let { return SigningIdentity.load(it.file, o.certificatePassword.toCharArray()) }
        val p12 = File(app.workspace.certDir, "pagio_personnel.p12")
        val pass = app.settings.ensureDeviceId().toCharArray()
        if (p12.exists()) runCatching { return SigningIdentity.load(p12, pass) }
        val name = o.signerName.ifBlank { app.account.value?.name?.ifBlank { null } ?: "Utilisateur Pagio" }
        return SigningIdentity.createSelfSigned(name, app.account.value?.email, p12, pass)
    }

    private fun metadataReport(m: com.pagio.engine.PdfMetadata): String {
        val fmt = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.FRANCE)
        return listOf(
            "Titre" to m.title, "Auteur" to m.author, "Sujet" to m.subject, "Mots-clés" to m.keywords,
            "Créé avec" to m.creator, "Producteur" to m.producer, "Créé le" to m.created?.let { fmt.format(it) },
            "Modifié le" to m.modified?.let { fmt.format(it) }, "Pages" to m.pageCount.toString(), "Version PDF" to m.pdfVersion.toString(),
            "Taille" to m.fileSize.humanSize(), "Chiffré" to if (m.encrypted) "oui" else "non", "Formulaire" to if (m.hasForms) "oui" else "non",
            "Signatures" to m.signatures.toString(), "Métadonnées XMP" to if (m.hasXmp) "oui" else "non", "Scripts / actions" to if (m.hasJavaScript) "oui ⚠" else "non",
        ).joinToString("\n") { "${it.first} : ${it.second ?: "—"}" }
    }

    companion object {
        fun loadMetadata(f: PickedFile): ToolOptions? = runCatching {
            val m = PdfSecurity.readMetadata(f.file, f.password)
            ToolOptions(metaTitle = m.title ?: "", metaAuthor = m.author ?: "", metaSubject = m.subject ?: "", metaKeywords = m.keywords ?: "", metaLoaded = true)
        }.getOrNull()

        @Suppress("unused") private val keep = EditElement::class
    }
}
