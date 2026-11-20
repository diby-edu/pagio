package com.pagio.app.data

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Suivi des plantages, sans service extérieur. Quand l'application plante, un résumé est écrit dans un petit
 * fichier privé (type d'erreur, message court, lignes du code de Pagio concernées, version, modèle d'Android).
 * Au lancement suivant, il est envoyé au serveur Pagio comme un événement « app_crash », visible dans le tableau
 * de bord (page Événements), SEULEMENT si l'utilisateur a accepté les statistiques anonymes. Sinon il est effacé.
 * Aucun contenu de document, aucun nom de fichier, aucune donnée personnelle n'est inclus.
 */
object CrashReporter {
    private const val FILE = "crash-report.json"

    fun install(context: Context, versionName: String) {
        val file = File(context.filesDir, FILE)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                val root = generateSequence(error) { it.cause }.last()
                val frames = (error.stackTrace + root.stackTrace)
                    .filter { it.className.startsWith("com.pagio") }
                    .distinct().take(8)
                    .joinToString("\n") { "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}" }
                file.writeText(JSONObject()
                    .put("error", error.javaClass.simpleName)
                    .put("cause", if (root !== error) root.javaClass.simpleName else "")
                    // Message tronqué et débarrassé des chemins de fichiers, qui pourraient contenir un nom de document.
                    .put("message", (root.message ?: "").replace(Regex("/[^\\s:]+"), "/…").take(200))
                    .put("where", frames)
                    .put("thread", thread.name.take(40))
                    .put("app_version", versionName)
                    .put("android", android.os.Build.VERSION.SDK_INT)
                    .put("ts", System.currentTimeMillis())
                    .toString())
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** Rapport du plantage précédent (puis effacé), ou null. */
    fun takePending(context: Context): JSONObject? {
        val file = File(context.filesDir, FILE)
        if (!file.exists()) return null
        val report = runCatching { JSONObject(file.readText()) }.getOrNull()
        file.delete()
        return report
    }
}
