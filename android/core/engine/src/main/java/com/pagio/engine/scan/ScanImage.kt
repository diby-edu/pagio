package com.pagio.engine.scan

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import com.pagio.engine.EngineError
import com.pagio.engine.EngineException
import com.pagio.engine.PdfCreate
import java.io.File

/** Partie Android du scanner de Pagio : lecture des photos, redressement de la feuille, enregistrement. */
object ScanImage {

    /** Cherche la feuille dans une photo déjà chargée (travaille sur une copie réduite, rapide). */
    fun detect(bmp: Bitmap): Quad? {
        val scale = 320f / maxOf(bmp.width, bmp.height)
        val w = maxOf(16, (bmp.width * scale).toInt()); val h = maxOf(16, (bmp.height * scale).toInt())
        val small = Bitmap.createScaledBitmap(bmp, w, h, true)
        val px = IntArray(w * h); small.getPixels(px, 0, w, 0, 0, w, h)
        if (small != bmp) small.recycle()
        return DocScan.detect(px, w, h)
    }

    /** Redresse la zone [quad] de [bmp] en un rectangle, puis applique le filtre et la rotation (0, 90, 180, 270). */
    fun render(bmp: Bitmap, quad: Quad, filter: ScanFilter, rotation: Int, maxDimension: Int): Bitmap {
        val (ow, oh) = DocScan.outputSize(quad, bmp.width, bmp.height, maxDimension)
        val src = FloatArray(8); val c = quad.corners
        for (i in 0 until 4) { src[i * 2] = c[i].x * (bmp.width - 1); src[i * 2 + 1] = c[i].y * (bmp.height - 1) }
        val dst = floatArrayOf(0f, 0f, ow.toFloat(), 0f, ow.toFloat(), oh.toFloat(), 0f, oh.toFloat())
        val m = Matrix()
        if (!m.setPolyToPoly(src, 0, dst, 0, 4)) throw EngineException(EngineError.UNSUPPORTED_FORMAT, "Les coins ne forment pas un cadre utilisable")
        var out = Bitmap.createBitmap(ow, oh, Bitmap.Config.ARGB_8888)
        Canvas(out).apply { drawColor(Color.WHITE); drawBitmap(bmp, m, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)) }
        if (filter != ScanFilter.ORIGINAL) {
            val px = IntArray(ow * oh); out.getPixels(px, 0, ow, 0, 0, ow, oh)
            DocScan.applyFilter(px, ow, oh, filter)
            out.setPixels(px, 0, ow, 0, 0, ow, oh)
        }
        val turns = ((rotation % 360) + 360) % 360
        if (turns != 0) {
            val r = Bitmap.createBitmap(out, 0, 0, ow, oh, Matrix().apply { postRotate(turns.toFloat()) }, true)
            if (r != out) { out.recycle(); out = r }
        }
        return out
    }

    /** Traite une photo complète et enregistre la page en JPEG. */
    fun process(source: File, quad: Quad, filter: ScanFilter, rotation: Int, output: File, maxDimension: Int = 2200): File {
        val bmp = PdfCreate.loadBitmap(source, maxDimension) ?: throw EngineException(EngineError.UNSUPPORTED_FORMAT, "Photo illisible")
        try {
            val page = render(bmp, quad, filter, rotation, maxDimension)
            output.outputStream().use { page.compress(Bitmap.CompressFormat.JPEG, 90, it) }
            page.recycle()
        } finally { bmp.recycle() }
        return output
    }
}
