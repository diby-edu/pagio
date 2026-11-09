package com.pagio.engine

import android.graphics.Bitmap
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDResources
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import java.io.File

enum class CompressionLevel(val maxDimension: Int, val jpegQuality: Float, val label: String) {
    LOW(2400, 0.85f, "Faible : haute qualité"),
    RECOMMENDED(1600, 0.65f, "Recommandée : bon équilibre"),
    EXTREME(1000, 0.40f, "Extrême : taille minimale"),
}

data class CompressionResult(val output: File, val originalBytes: Long, val newBytes: Long, val imagesRecompressed: Int) {
    val savedPercent: Int get() = if (originalBytes <= 0) 0 else (100 - newBytes * 100 / originalBytes).toInt()
}

object PdfOptimize {

    /**
     * Compression locale : ré-échantillonne et ré-encode en JPEG les images trop lourdes,
     * supprime les métadonnées XMP inutiles et réécrit le fichier. Si le résultat n'est pas plus
     * petit, l'original est conservé (on ne rend jamais un fichier plus gros).
     */
    fun compress(input: File, level: CompressionLevel, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): CompressionResult =
        input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val done = HashSet<COSName>()
            var count = 0
            val seen = HashSet<Any>()
            doc.pages.forEachIndexed { i, page ->
                ctx.progress(i.toFloat() / doc.numberOfPages * 0.9f, "Optimisation des images (page ${i + 1})")
                page.resources?.let { count += processResources(doc, it, level, seen, 0) }
            }
            doc.documentCatalog.metadata = null
            ctx.progress(0.95f, "Enregistrement…")
            doc.save(output)
            done.clear()
            if (output.length() >= input.length() && password.isNullOrEmpty()) {
                input.copyTo(output, overwrite = true)
            }
            CompressionResult(output, input.length(), output.length(), count)
        }

    private fun processResources(doc: PDDocument, res: PDResources, level: CompressionLevel, seen: HashSet<Any>, depth: Int): Int {
        if (depth > 6) return 0
        var count = 0
        for (name in res.xObjectNames.toList()) {
            val xo = runCatching { res.getXObject(name) }.getOrNull() ?: continue
            if (!seen.add(xo.cosObject)) continue
            when (xo) {
                is PDImageXObject -> {
                    val replaced = recompress(doc, xo, level)
                    if (replaced != null) { res.put(name, replaced); count++ }
                }
                is PDFormXObject -> xo.resources?.let { count += processResources(doc, it, level, seen, depth + 1) }
            }
        }
        return count
    }

    private fun recompress(doc: PDDocument, img: PDImageXObject, level: CompressionLevel): PDImageXObject? {
        return try {
            // Les images avec transparence ou masques sont conservées telles quelles.
            if (img.cosObject.containsKey(COSName.SMASK) || img.cosObject.containsKey(COSName.MASK) || img.isStencil) return null
            val originalLen = img.cosObject.length
            if (originalLen < 20_000) return null
            val bmp = img.image ?: return null
            val scale = minOf(1f, level.maxDimension.toFloat() / maxOf(bmp.width, bmp.height))
            val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt().coerceAtLeast(1), (bmp.height * scale).toInt().coerceAtLeast(1), true) else bmp
            val rgb = if (scaled.config != Bitmap.Config.ARGB_8888) scaled.copy(Bitmap.Config.ARGB_8888, false) else scaled
            val jpeg = JPEGFactory.createFromImage(doc, rgb, level.jpegQuality)
            if (jpeg.cosObject.length < originalLen) jpeg else null
        } catch (_: Throwable) {
            null // image exotique (JBIG2, JPX…) : laissée intacte
        }
    }

    /**
     * Réparation : relit le fichier avec l'analyseur tolérant (reconstruction de la table des
     * références, des longueurs de flux), enlève les pages illisibles puis réécrit un PDF propre.
     */
    fun repair(input: File, output: File, ctx: TaskContext = TaskContext.NONE, password: String? = null): RepairReport {
        ctx.progress(0.1f, "Analyse du fichier…")
        val doc = try { openPdf(input, password) } catch (e: EngineException) {
            if (e.code == EngineError.PASSWORD_REQUIRED || e.code == EngineError.WRONG_PASSWORD) throw e
            throw EngineException(EngineError.CORRUPTED, "Le fichier est trop endommagé pour être réparé (structure PDF introuvable)", e)
        }
        doc.use { d ->
            if (d.isEncrypted) d.isAllSecurityToBeRemoved = true
            val pages = d.numberOfPages
            val removed = mutableListOf<Int>()
            for (i in pages - 1 downTo 0) {
                val ok = runCatching { d.getPage(i).contents?.use { it.read() }; true }.getOrDefault(false)
                if (!ok) { d.removePage(i); removed += i + 1 }
            }
            ctx.progress(0.8f, "Réécriture…")
            d.save(output)
            return RepairReport(output, pages, removed.sorted())
        }
    }
}

data class RepairReport(val output: File, val pageCount: Int, val removedPages: List<Int>)
