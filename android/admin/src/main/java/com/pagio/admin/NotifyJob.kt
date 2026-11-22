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
 * d'admin.pagio.site et prévient de ce qui est nouveau — alerte du serveur, message d'utilisateur, panne réparée.
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
            val conn = (URL(BuildConfig.ADMIN_URL + "/api/admin/notify/feed").openConnection() as HttpsURLConnection).apply {
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
            val first = store.lastFeedbackId < 0 && store.lastIncident < 0 && store.seenAlerts.isEmpty()

            // Alertes : chacune notifiée une fois tant qu'elle dure (les messages des utilisateurs sont traités à part).
            val alerts = feed.optJSONArray("alerts")
            val current = mutableSetOf<String>()
            for (i in 0 until (alerts?.length() ?: 0)) {
                val a = alerts!!.getJSONObject(i)
                if (a.optString("code") == "feedback") continue
                val id = a.optString("code") + "|" + a.optString("message")
                current += id
                if (!first && id !in store.seenAlerts) {
                    val title = if (a.optString("level") == "critical") "⚠ Pagio : urgent" else "Pagio : à surveiller"
                    notify(context, CH_ALERTS, id.hashCode(), title, a.optString("message"))
                }
            }
            store.seenAlerts = current

            // Messages des utilisateurs.
            val fb = feed.optJSONArray("feedback")
            var maxId = store.lastFeedbackId
            for (i in 0 until (fb?.length() ?: 0)) {
                val m = fb!!.getJSONObject(i)
                val id = m.optLong("id")
                if (id > maxId) maxId = id
                if (!first && id > store.lastFeedbackId) notify(context, CH_MESSAGES, 10_000 + id.toInt(), context.getString(R.string.message_title), m.optString("message"))
            }
            store.lastFeedbackId = maxOf(maxId, 0)

            // Pannes réparées par le gardien.
            val inc = feed.optJSONArray("incidents")
            var last = store.lastIncident
            for (i in 0 until (inc?.length() ?: 0)) {
                val o = inc!!.getJSONObject(i)
                val start = o.optLong("debut")
                if (start > last) last = start
                if (!first && start > store.lastIncident) {
                    val s = o.optLong("duree_s")
                    val d = if (s < 60) "$s s" else "${(s + 59) / 60} min"
                    val how = context.getString(if (o.optBoolean("redemarre")) R.string.outage_restarted else R.string.outage_alone)
                    notify(context, CH_ALERTS, (start / 1000).toInt(), context.getString(R.string.outage_title), context.getString(R.string.outage_text, d, how))
                }
            }
            store.lastIncident = maxOf(last, 0)
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
