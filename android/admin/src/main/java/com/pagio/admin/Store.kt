package com.pagio.admin

import android.content.Context
import android.content.SharedPreferences

/**
 * Réglages du téléphone (stockage privé de l'application) : certificat choisi, clé de notification et ce qui a déjà été
 * notifié. La clé de notification ne permet que de lire le flux de notifications ; elle est révocable depuis le tableau de bord.
 */
class Store(context: Context) {
    private val p: SharedPreferences = context.getSharedPreferences("pagio_admin", Context.MODE_PRIVATE)

    var certAlias: String?
        get() = p.getString("cert_alias", null)
        set(v) = p.edit().putString("cert_alias", v).apply()

    var notifyKey: String?
        get() = p.getString("notify_key", null)
        set(v) = p.edit().putString("notify_key", v).apply()

    var adminEmail: String?
        get() = p.getString("admin_email", null)
        set(v) = p.edit().putString("admin_email", v).apply()

    /** Alertes en cours déjà signalées (code + message) : une alerte n'est notifiée qu'une fois tant qu'elle dure. */
    var seenAlerts: Set<String>
        get() = p.getStringSet("seen_alerts", emptySet()) ?: emptySet()
        set(v) = p.edit().putStringSet("seen_alerts", v).apply()

    var lastFeedbackId: Long
        get() = p.getLong("last_feedback", -1)
        set(v) = p.edit().putLong("last_feedback", v).apply()

    var lastIncident: Long
        get() = p.getLong("last_incident", -1)
        set(v) = p.edit().putLong("last_incident", v).apply()

    var failures: Int
        get() = p.getInt("failures", 0)
        set(v) = p.edit().putInt("failures", v).apply()

    var downNotified: Boolean
        get() = p.getBoolean("down_notified", false)
        set(v) = p.edit().putBoolean("down_notified", v).apply()

    /** Configuration Firebase reçue du serveur (identifiants publics de l'application, en JSON). */
    var firebaseConfig: String?
        get() = p.getString("firebase_config", null)
        set(v) = p.edit().putString("firebase_config", v).apply()

    /** Dernier jeton Firebase transmis au serveur (pour ne le renvoyer que s'il change). */
    var pushTokenSent: String?
        get() = p.getString("push_token_sent", null)
        set(v) = p.edit().putString("push_token_sent", v).apply()

    /** Numéro du dernier événement lu dans le flux (-1 : jamais lu, on part du présent). */
    var lastEventId: Long
        get() = p.getLong("last_event", -1)
        set(v) = p.edit().putLong("last_event", v).apply()

    /** Événements déjà affichés (par Firebase ou par le flux) : un événement n'est jamais montré deux fois. */
    @Synchronized fun markShown(id: Long): Boolean {
        val set = p.getStringSet("shown_events", emptySet()).orEmpty()
        if (id.toString() in set) return false
        val next = (set.mapNotNull { it.toLongOrNull() } + id).sortedDescending().take(200).map { it.toString() }.toSet()
        p.edit().putStringSet("shown_events", next).commit()
        return true
    }

    /** Nouvelle clé (nouvelle connexion) : on repart de zéro, sans renotifier l'historique. */
    fun resetNotifications() {
        p.edit().remove("seen_alerts").remove("last_feedback").remove("last_incident").remove("failures").remove("down_notified")
            .remove("last_event").remove("shown_events").remove("push_token_sent").apply()
    }
}
