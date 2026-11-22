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

    /** Nouvelle clé (nouvelle connexion) : on repart de zéro, sans renotifier l'historique. */
    fun resetNotifications() {
        p.edit().remove("seen_alerts").remove("last_feedback").remove("last_incident").remove("failures").remove("down_notified").apply()
    }
}
