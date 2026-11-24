package com.pagio.app.data

import org.json.JSONObject
import java.io.File

/**
 * Statistiques en attente d'envoi, gardées dans un fichier privé de l'application : utiliser Pagio sans internet ne
 * fait rien perdre, tout part au retour de la connexion (même après fermeture de l'application ou redémarrage).
 * Une ligne JSON par événement ; au plus [MAX] événements gardés (les plus anciens sont abandonnés au-delà).
 */
class EventQueue(private val file: File) {
    private val lock = Any()

    fun add(event: JSONObject) = synchronized(lock) {
        runCatching { file.appendText(event.toString() + "\n") }
        if (file.length() > MAX_BYTES) trimTo(MAX)
    }

    fun size(): Int = synchronized(lock) { lines().size }

    /** Les [n] plus anciens événements, sans les retirer. */
    fun peek(n: Int): List<JSONObject> = synchronized(lock) {
        lines().take(n).mapNotNull { runCatching { JSONObject(it) }.getOrNull() }
    }

    /** Retire les [n] plus anciens événements, une fois leur envoi confirmé par le serveur. */
    fun drop(n: Int) = synchronized(lock) {
        val rest = lines().drop(n)
        runCatching { if (rest.isEmpty()) file.delete() else file.writeText(rest.joinToString("\n", postfix = "\n")) }
    }

    private fun trimTo(keep: Int) {
        val all = lines()
        if (all.size > keep) runCatching { file.writeText(all.takeLast(keep).joinToString("\n", postfix = "\n")) }
    }

    private fun lines(): List<String> = runCatching { if (file.exists()) file.readLines().filter { it.isNotBlank() } else emptyList() }.getOrDefault(emptyList())

    companion object {
        const val MAX = 5000
        private const val MAX_BYTES = 3L * 1024 * 1024
    }
}
