package com.pagio.engine

import com.tom_roush.pdfbox.multipdf.PDFMergerUtility
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import java.io.File

/** Une opération d'organisation sur une page source (indice 0-based du document d'origine). */
data class PageSpec(
    val sourceIndex: Int,          // -1 = page blanche insérée
    val extraRotation: Int = 0,    // 0, 90, 180, 270 (sens horaire)
)

/** Opérations sur les pages : fusion, division, extraction, suppression, rotation, réorganisation. */
object PdfPages {

    fun pageCount(file: File, password: String? = null): Int = file.usePdf(password) { it.numberOfPages }

    /** Fusionne les fichiers dans l'ordre donné. Les formulaires sont conservés. */
    fun merge(inputs: List<File>, output: File, ctx: TaskContext = TaskContext.NONE, passwords: Map<File, String> = emptyMap()): File {
        if (inputs.size < 2) throw EngineException(EngineError.EMPTY_INPUT, "Sélectionnez au moins deux PDF à fusionner")
        val out = PDDocument()
        val opened = mutableListOf<PDDocument>()
        try {
            val merger = PDFMergerUtility()
            inputs.forEachIndexed { i, f ->
                ctx.progress(i.toFloat() / inputs.size, "Fusion de « ${f.name} »")
                val src = openPdf(f, passwords[f])
                if (src.isEncrypted) src.isAllSecurityToBeRemoved = true
                opened += src
                merger.appendDocument(out, src)
            }
            ctx.progress(0.95f, "Enregistrement…")
            out.save(output)
        } finally {
            out.close(); opened.forEach { it.close() }
        }
        return output
    }

    /** Crée un PDF par intervalle (ou un seul PDF si [mergeRanges]). */
    fun splitByRanges(
        input: File, ranges: List<IntRange>, outDir: File, mergeRanges: Boolean = false,
        ctx: TaskContext = TaskContext.NONE, password: String? = null,
    ): List<File> = input.usePdf(password) { src ->
        if (src.isEncrypted) src.isAllSecurityToBeRemoved = true
        val results = mutableListOf<File>()
        if (mergeRanges) {
            val out = PDDocument()
            ranges.forEach { r -> r.forEach { p -> out.importPage(src.getPage(p - 1)) } }
            val f = outputFile(outDir, "${input.baseName()}_pages", "pdf")
            out.use { it.save(f) }
            results += f
        } else {
            ranges.forEachIndexed { i, r ->
                ctx.progress(i.toFloat() / ranges.size, "Création du fichier ${i + 1}/${ranges.size}")
                val out = PDDocument()
                r.forEach { p -> out.importPage(src.getPage(p - 1)) }
                val label = if (r.first == r.last) "${r.first}" else "${r.first}-${r.last}"
                val f = outputFile(outDir, "${input.baseName()}_p$label", "pdf")
                out.use { it.save(f) }
                results += f
            }
        }
        results
    }

    /** Une page = un fichier. */
    fun extractAll(input: File, outDir: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): List<File> {
        val n = pageCount(input, password)
        return splitByRanges(input, (1..n).map { it..it }, outDir, false, ctx, password)
    }

    /**
     * Divise en fichiers ne dépassant pas [maxBytes] (au mieux : une page seule plus grosse
     * que la limite reste dans son propre fichier).
     */
    fun splitBySize(input: File, maxBytes: Long, outDir: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): List<File> =
        input.usePdf(password) { src ->
            if (src.isEncrypted) src.isAllSecurityToBeRemoved = true
            outDir.mkdirs()
            val results = mutableListOf<File>()
            var start = 0
            val n = src.numberOfPages
            while (start < n) {
                ctx.progress(start.toFloat() / n, "Découpage par taille…")
                var end = start
                var lastGood: File? = null
                while (end < n) {
                    val candidate = File.createTempFile("pagio_sz", ".pdf", outDir)
                    PDDocument().use { out ->
                        for (p in start..end) out.importPage(src.getPage(p))
                        out.save(candidate)
                    }
                    if (candidate.length() <= maxBytes || end == start) {
                        lastGood?.delete(); lastGood = candidate; end++
                        if (candidate.length() > maxBytes) break
                    } else { candidate.delete(); break }
                }
                val label = if (end - 1 == start) "${start + 1}" else "${start + 1}-$end"
                val f = outputFile(outDir, "${input.baseName()}_p$label", "pdf")
                lastGood!!.renameTo(f)
                results += f
                start = end
            }
            results
        }

    /** Conserve uniquement les pages listées (1-based), dans cet ordre. */
    fun extractPages(input: File, pages: List<Int>, output: File, password: String? = null): File =
        input.usePdf(password) { src ->
            if (src.isEncrypted) src.isAllSecurityToBeRemoved = true
            PDDocument().use { out ->
                pages.forEach { p -> out.importPage(src.getPage(p - 1)) }
                out.save(output)
            }
            output
        }

    fun deletePages(input: File, pages: Set<Int>, output: File, password: String? = null): File {
        val total = pageCount(input, password)
        val keep = (1..total).filter { it !in pages }
        if (keep.isEmpty()) throw EngineException(EngineError.INVALID_RANGE, "Impossible de supprimer toutes les pages")
        return extractPages(input, keep, output, password)
    }

    /** Fait pivoter les pages indiquées (toutes si null) de [degrees] (multiple de 90). */
    fun rotate(input: File, degrees: Int, pages: Set<Int>?, output: File, password: String? = null): File =
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            doc.pages.forEachIndexed { i, page ->
                if (pages == null || (i + 1) in pages) page.rotation = ((page.rotation + degrees) % 360 + 360) % 360
            }
            doc.save(output); output
        }

    /**
     * Reconstruit le document selon [specs] : réordonner, dupliquer (même index deux fois),
     * supprimer (index absent), pivoter, insérer des pages blanches.
     */
    fun organize(input: File, specs: List<PageSpec>, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): File =
        input.usePdf(password) { src ->
            if (src.isEncrypted) src.isAllSecurityToBeRemoved = true
            if (specs.isEmpty()) throw EngineException(EngineError.INVALID_RANGE, "Le document doit garder au moins une page")
            PDDocument().use { out ->
                specs.forEachIndexed { i, spec ->
                    ctx.progress(i.toFloat() / specs.size)
                    if (spec.sourceIndex < 0) {
                        val ref = src.getPage(0).mediaBox
                        out.addPage(PDPage(PDRectangle(ref.width, ref.height)))
                    } else {
                        val srcPage = src.getPage(spec.sourceIndex)
                        // importPage partage l'objet : pour une duplication on clone le dictionnaire.
                        val page = if (specs.count { it.sourceIndex == spec.sourceIndex } > 1)
                            PDPage(com.tom_roush.pdfbox.cos.COSDictionary(srcPage.cosObject)).also { out.addPage(it) }
                        else out.importPage(srcPage)
                        page.rotation = ((srcPage.rotation + spec.extraRotation) % 360 + 360) % 360
                    }
                }
                out.save(output)
            }
            output
        }
}
