package com.pagio.admin

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import org.json.JSONObject
import java.io.IOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlin.concurrent.thread

/**
 * Vérification toutes les 15 minutes (le minimum qu'Android autorise en arrière-plan) : lit le flux de notifications
 * d'admin.pagio.site et montre les nouveaux événements cochés dans le tableau de bord (alertes, pannes réparées,
 * messages, paiements, Premium, inscriptions). Avec Firebase, ils arrivent en plus tout de suite (PushService).
 * Si le serveur ne répond pas deux fois de suite (≈ 30 min) alors qu'Internet fonctionne : « Pagio ne répond pas ».
 */
class NotifyJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        thread { runCatching { check(applicationContext) }; jobFinished(params, false) }
        return true
    }

    override fun onStopJob(params: JobParameters) = true

    companion object {
        private const val JOB_ID = 4242
        const val CH_ALERTS = "alertes"
        const val CH_MESSAGES = "messages"
        const val CH_BUSINESS = "activite"
        const val CH_QUIET = "silencieux"

        fun schedule(context: Context) {
            val job = JobInfo.Builder(JOB_ID, ComponentName(context, NotifyJob::class.java))
                .setPeriodic(15 * 60_000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build()
            context.getSystemService(JobScheduler::class.java).schedule(job)
        }

        fun cancel(context: Context) = context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)

        fun channels(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH_ALERTS, context.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = context.getString(R.string.channel_alerts_d) })
            nm.createNotificationChannel(NotificationChannel(CH_MESSAGES, context.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = context.getString(R.string.channel_messages_d) })
            nm.createNotificationChannel(NotificationChannel(CH_BUSINESS, context.getString(R.string.channel_business), NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = context.getString(R.string.channel_business_d) })
            nm.createNotificationChannel(NotificationChannel(CH_QUIET, context.getString(R.string.channel_quiet), NotificationManager.IMPORTANCE_LOW)
                .apply { description = context.getString(R.string.channel_quiet_d) })
        }

        private fun online(context: Context): Boolean {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
            return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        }

        /** Une vérification (appelée hors du fil principal). */
        fun check(context: Context) {
            val store = Store(context)
            val key = store.notifyKey ?: return
            val cert = ClientCert.load(context) ?: return // pas de certificat autorisé : rien à vérifier
            if (!online(context)) return
            val since = store.lastEventId
            val conn = (URL(BuildConfig.ADMIN_URL + "/api/admin/notify/feed" + (if (since >= 0) "?since=$since" else "")).openConnection() as HttpsURLConnection).apply {
                sslSocketFactory = ClientCert.socketFactory(cert)
                connectTimeout = 20_000; readTimeout = 20_000
                setRequestProperty("x-pagio-notify", key)
            }
            val code = try { conn.responseCode } catch (e: IOException) { -1 }
            when {
                code == 401 -> {
                    notify(context, CH_ALERTS, 1, context.getString(R.string.revoked_title), context.getString(R.string.revoked_text))
                    store.notifyKey = null; cancel(context); return
                }
                code != 200 -> {
                    store.failures = store.failures + 1
                    if (store.failures >= 2 && !store.downNotified) {
                        notify(context, CH_ALERTS, 2, context.getString(R.string.down_title), context.getString(R.string.down_text))
                        store.downNotified = true
                    }
                    return
                }
            }
            val feed = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            if (store.downNotified) notify(context, CH_ALERTS, 2, context.getString(R.string.up_title), context.getString(R.string.up_text))
            store.failures = 0; store.downNotified = false

            // Événements cochés dans le tableau de bord (alertes, pannes réparées, messages, paiements, Premium,
            // inscriptions, essai). Ceux déjà montrés par Firebase ne reviennent pas.
            if (since < 0) {
                store.lastEventId = feed.optLong("last_event") // première lecture : on part d'ici, sans l'historique
            } else {
                val evs = feed.optJSONArray("events")
                var max = since
                for (i in 0 until (evs?.length() ?: 0)) {
                    val e = evs!!.getJSONObject(i)
                    val id = e.optLong("id")
                    if (id > max) max = id
                    showEvent(context, id, e.optString("kind"), e.optString("level"), e.optString("title"), e.optString("body"), e.optBoolean("silent"))
                }
                store.lastEventId = maxOf(max, feed.optLong("scanned_to", max))
            }
            runCatching { Push.sync(context) } // Firebase : configuration et jeton du téléphone
        }

        /** Affiche un événement (une seule fois, qu'il arrive par Firebase ou par le flux). */
        fun showEvent(context: Context, id: Long, kind: String, level: String, title: String, body: String, silent: Boolean) {
            if (!Store(context).markShown(id)) return
            val channel = when {
                silent -> CH_QUIET
                kind == "critical" || kind == "warning" || kind == "outage" || kind == "test" -> CH_ALERTS
                kind == "feedback" -> CH_MESSAGES
                else -> CH_BUSINESS
            }
            notify(context, channel, (100_000 + id % 1_000_000).toInt(), title, body)
        }

        private fun notify(context: Context, channel: String, id: Int, title: String, text: String) {
            channels(context)
            val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = android.app.Notification.Builder(context, channel)
                .setSmallIcon(android.R.drawable.stat_notify_error.takeIf { channel == CH_ALERTS } ?: android.R.drawable.stat_notify_chat)
                .setContentTitle(title).setContentText(text)
                .setStyle(android.app.Notification.BigTextStyle().bigText(text))
                .setContentIntent(open).setAutoCancel(true).build()
            if (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                context.getSystemService(NotificationManager::class.java).notify(id, n)
            }
        }
    }
}

/** Après un redémarrage du téléphone : reprise des vérifications (si une clé de notification existe). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && Store(context).notifyKey != null) NotifyJob.schedule(context)
    }
}
