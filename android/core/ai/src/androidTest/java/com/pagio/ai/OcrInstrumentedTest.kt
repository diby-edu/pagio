package com.pagio.ai

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** OCR et détection de langue réels, sur l'appareil, sans réseau. */
@RunWith(AndroidJUnit4::class)
class OcrInstrumentedTest {

    private fun render(lines: List<String>): Bitmap {
        val bmp = Bitmap.createBitmap(1400, 120 + lines.size * 90, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp); c.drawColor(Color.WHITE)
        val p = Paint().apply { color = Color.BLACK; textSize = 56f; isAntiAlias = true }
        lines.forEachIndexed { i, l -> c.drawText(l, 60f, 100f + i * 90f, p) }
        return bmp
    }

    @Test fun recognizesPrintedFrenchText() = runBlocking {
        val page = OcrService().recognize(render(listOf("Facture numero 2026-17", "Total TTC 1500 euros", "Merci pour votre confiance")))
        val t = page.text.lowercase()
        assertTrue(t, t.contains("facture"))
        assertTrue(t, t.contains("1500"))
        assertTrue(page.lines.size >= 3)
        page.lines.forEach { assertTrue(it.left in 0f..1f && it.bottom in 0f..1f && it.top < it.bottom) }
    }

    @Test fun detectsLanguages() = runBlocking {
        val d = LanguageDetector()
        assertEquals("fr", d.detect("Bonjour, je vous écris pour confirmer notre rendez-vous de demain matin à la mairie."))
        assertEquals("en", d.detect("Hello, I am writing to confirm our appointment tomorrow morning at the town hall."))
    }

    @Test fun offlineAssistantWorksWithoutProvider() = runBlocking {
        val a = DocumentAssistant(null)
        val text = "FACTURE N° A-77\nDate : 01/02/2026\nTotal TTC : 120,00 €\n" + "Le client accepte les conditions générales de vente. ".repeat(20)
        assertTrue(a.invoice(text).text.contains("A-77"))
        assertTrue(a.classify(text).text.contains("Facture"))
        assertTrue(a.summarize(text).offline)
    }
}
