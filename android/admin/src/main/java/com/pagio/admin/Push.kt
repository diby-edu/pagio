package com.pagio.admin

import android.app.Application
import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlin.concurrent.thread

/**
 * Notifications instantanées par Firebase Cloud Messaging. La configuration Firebase (identifiants publics de
 * l'application) est donnée par le serveur une fois réglée dans le tableau de bord ; elle est gardée sur le téléphone
 * pour que Firebase démarre avec l'application, même hors connexion.
 */
object Push {
    private fun options(json: String): FirebaseOptions? = runCatching {
        val c = JSONObject(json)
        FirebaseOptions.Builder()
            .setApplicationId(c.getString("app_id")).setApiKey(c.getString("api_key"))
            .setProjectId(c.getString("project_id")).setGcmSenderId(c.getString("sender_id")).build()
    }.getOrNull()

    /** Démarre Firebase si une configuration est connue (appelé au lancement de l'application). */
    fun start(context: Context): Boolean {
        if (FirebaseApp.getApps(context).isNotEmpty()) return true
        val o = Store(context).firebaseConfig?.let(::options) ?: return false
        return runCatching { FirebaseApp.initializeApp(context, o); true }.getOrDefault(false)
    }

    private fun call(context: Context, path: String, body: JSONObject? = null): JSONObject? {
        val store = Store(context)
        val key = store.notifyKey ?: return null
        val cert = ClientCert.load(context) ?: return null
        val conn = (URL(BuildConfig.ADMIN_URL + path).openConnection() as HttpsURLConnection).apply {
            sslSocketFactory = ClientCert.socketFactory(cert)
            connectTimeout = 20_000; readTimeout = 20_000
            setRequestProperty("x-pagio-notify", key)
            if (body != null) {
                requestMethod = "POST"; doOutput = true
                setRequestProperty("content-type", "application/json")
                outputStream.use { it.write(body.toString().toByteArray()) }
            }
        }
        return runCatching { if (conn.responseCode == 200) JSONObject(conn.inputStream.bufferedReader().use { it.readText() }) else null }.getOrNull()
    }

    /**
     * À chaque vérification (hors du fil principal) : récupère la configuration Firebase si elle est nouvelle, démarre
     * Firebase et envoie au serveur le jeton du téléphone s'il ne l'a pas encore.
     */
    fun sync(context: Context) {
        val store = Store(context)
        val conf = call(context, "/api/admin/notify/firebase") ?: return
        if (!conf.optBoolean("enabled")) return
        conf.remove("enabled")
        if (store.firebaseConfig != conf.toString()) {
            store.firebaseConfig = conf.toString()
            store.pushTokenSent = null
        }
        if (!start(context)) return
        val token = runCatching { com.google.android.gms.tasks.Tasks.await(FirebaseMessaging.getInstance().token) }.getOrNull() ?: return
        if (token != store.pushTokenSent) sendToken(context, token)
    }

    fun sendToken(context: Context, token: String) {
        if (call(context, "/api/admin/notify/push-token", JSONObject().put("token", token)) != null) Store(context).pushTokenSent = token
    }
}

/** Démarre Firebase dès l'ouverture du processus (nécessaire pour recevoir un message application fermée). */
class AdminApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Push.start(this)
    }
}

/** Réception d'un message Firebase : la notification est fabriquée ici (bon canal, son ou silence la nuit). */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        thread { runCatching { Push.sendToken(applicationContext, token) } }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        val id = d["id"]?.toLongOrNull() ?: return
        NotifyJob.showEvent(applicationContext, id, d["kind"].orEmpty(), d["level"].orEmpty(), d["title"].orEmpty(), d["body"].orEmpty(), d["silent"] == "1")
    }
}
