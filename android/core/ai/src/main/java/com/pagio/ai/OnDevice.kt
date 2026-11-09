package com.pagio.ai

import android.graphics.Bitmap
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.tasks.await

/** Ligne reconnue, coordonnées normalisées 0..1 (origine en haut à gauche). */
data class RecognizedLine(val text: String, val left: Float, val top: Float, val right: Float, val bottom: Float, val confidence: Float?)

data class RecognizedPage(val text: String, val lines: List<RecognizedLine>)

/**
 * OCR 100 % sur l'appareil (modèle ML Kit intégré à l'application, alphabet latin :
 * français, anglais, espagnol, allemand, italien, portugais, etc.). Aucun envoi réseau.
 */
class OcrService {
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    suspend fun recognize(bitmap: Bitmap): RecognizedPage {
        val result = recognizer.process(InputImage.fromBitmap(bitmap, 0)).await()
        val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
        val lines = result.textBlocks.flatMap { block ->
            block.lines.mapNotNull { line ->
                val box = line.boundingBox ?: return@mapNotNull null
                RecognizedLine(line.text, box.left / w, box.top / h, box.right / w, box.bottom / h, line.confidence)
            }
        }
        return RecognizedPage(result.text, lines)
    }

    fun close() = recognizer.close()
}

/** Détection de langue sur l'appareil (plus de 100 langues). */
class LanguageDetector {
    private val client by lazy { LanguageIdentification.getClient() }

    /** Code BCP-47 (ex. « fr ») ou null si indéterminé. */
    suspend fun detect(text: String): String? {
        val sample = text.take(2000)
        if (sample.isBlank()) return null
        val code = client.identifyLanguage(sample).await()
        return code.takeIf { it != "und" }
    }

    fun close() = client.close()

    companion object {
        private val names = mapOf(
            "fr" to "Français", "en" to "Anglais", "es" to "Espagnol", "de" to "Allemand", "it" to "Italien",
            "pt" to "Portugais", "nl" to "Néerlandais", "ar" to "Arabe", "zh" to "Chinois", "ja" to "Japonais",
            "ru" to "Russe", "pl" to "Polonais", "tr" to "Turc", "sw" to "Swahili", "ln" to "Lingala",
            "wo" to "Wolof", "ro" to "Roumain", "sv" to "Suédois", "uk" to "Ukrainien", "ko" to "Coréen",
        )
        fun displayName(code: String?): String = code?.let { names[it.substringBefore('-')] ?: it } ?: "Indéterminée"
    }
}

/**
 * Traduction sur l'appareil. Le modèle de chaque langue (~30 Mo) est téléchargé une seule fois,
 * ensuite la traduction fonctionne hors ligne.
 */
class OnDeviceTranslator {
    val supportedLanguages: List<String> get() = TranslateLanguage.getAllLanguages()

    suspend fun translate(text: String, from: String, to: String, wifiOnly: Boolean = false, onProgress: (Float) -> Unit = {}): String {
        val src = TranslateLanguage.fromLanguageTag(from) ?: throw AiException("Langue source non prise en charge hors ligne : $from")
        val dst = TranslateLanguage.fromLanguageTag(to) ?: throw AiException("Langue cible non prise en charge hors ligne : $to")
        if (src == dst) return text
        val translator = Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(src).setTargetLanguage(dst).build())
        try {
            val cond = DownloadConditions.Builder().apply { if (wifiOnly) requireWifi() }.build()
            translator.downloadModelIfNeeded(cond).await()
            val paragraphs = text.split(Regex("\n{2,}"))
            val out = StringBuilder()
            paragraphs.forEachIndexed { i, p ->
                onProgress(i.toFloat() / paragraphs.size)
                if (p.isNotBlank()) out.append(translator.translate(p).await())
                if (i < paragraphs.size - 1) out.append("\n\n")
            }
            return out.toString()
        } finally {
            translator.close()
        }
    }
}

class AiException(message: String, cause: Throwable? = null) : Exception(message, cause)
