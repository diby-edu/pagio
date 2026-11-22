package com.pagio.admin

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.security.KeyChain
import android.util.Base64
import android.webkit.ClientCertRequest
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import java.io.File
import kotlin.concurrent.thread

/**
 * Le tableau de bord d'admin.pagio.site, exactement comme sur PC (mêmes modules, même connexion avec double
 * authentification), dans une application qui présente le certificat d'appareil et reçoit les notifications.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var store: Store
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val home get() = BuildConfig.ADMIN_URL + "/"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        NotifyJob.channels(this)
        if (store.notifyKey != null) NotifyJob.schedule(this)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.userAgentString = settings.userAgentString + " PagioAdmin/" + BuildConfig.VERSION_NAME
            addJavascriptInterface(Bridge(), "PagioAdmin")
            webViewClient = Client()
            webChromeClient = Chrome()
        }
        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(home)
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }

    @Deprecated("Retour arrière dans l'historique du tableau de bord")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed() }

    private inner class Client : WebViewClient() {
        /** Le serveur demande le certificat d'appareil : celui autorisé une fois, sinon le choix dans le coffre d'Android. */
        override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) {
            thread {
                val m = ClientCert.load(this@MainActivity)
                if (m != null) { request.proceed(m.key, m.chain); return@thread }
                runOnUiThread {
                    KeyChain.choosePrivateKeyAlias(this@MainActivity, { alias ->
                        if (alias == null) { request.cancel(); runOnUiThread { showHelp() }; return@choosePrivateKeyAlias }
                        store.certAlias = alias
                        val chosen = ClientCert.load(this@MainActivity)
                        if (chosen != null) request.proceed(chosen.key, chosen.chain) else { request.cancel(); runOnUiThread { showHelp() } }
                    }, request.keyTypes, request.principals, request.host, request.port, null)
                }
            }
        }

        /** Les liens hors de l'administration (site public, e-mails…) s'ouvrent dans le navigateur. */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.host == Uri.parse(BuildConfig.ADMIN_URL).host) return false
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
            return true
        }

        /** Connexion refusée (pas de certificat valable) ou pas de réseau : page d'aide au lieu d'un écran vide. */
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showHelp(error.description?.toString())
        }
    }

    private inner class Chrome : WebChromeClient() {
        /** Choix d'un fichier (import d'une sauvegarde, etc.). */
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return runCatching { startActivityForResult(params.createIntent(), 77); true }.getOrElse { fileCallback = null; false }
        }
    }

    @Deprecated("Résultat du choix de fichier")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 77) { fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); fileCallback = null }
    }

    private fun showHelp(detail: String? = null) {
        val html = """
            <!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="font-family:sans-serif;padding:24px;line-height:1.55;color:#14152b;background:#f7f6fc">
            <h2 style="color:#4535c9">Accès réservé aux appareils autorisés</h2>
            <p>Pagio Admin n'a pas pu ouvrir le tableau de bord${if (detail != null) " (<i>${detail.replace("<", "&lt;")}</i>)" else ""}.</p>
            <p><b>Si c'est la première fois</b>, installez le certificat de ce téléphone :</p>
            <ol>
              <li>Copiez sur le téléphone le fichier <b>.p12</b> créé pour lui sur le VPS (<code>admin-appareils.sh nouveau telephone</code>).</li>
              <li>Ouvrez <b>Paramètres › Sécurité › Plus de paramètres de sécurité › Chiffrement et identifiants › Installer un certificat › Certificat utilisateur VPN et appli</b> (le chemin varie un peu selon les téléphones), choisissez le fichier et saisissez son code.</li>
              <li>Revenez ici et touchez « Réessayer » : choisissez ce certificat quand Android le propose.</li>
            </ol>
            <p>Sinon, vérifiez la connexion Internet.</p>
            <button onclick="PagioAdmin.retry()" style="font-size:17px;padding:12px 22px;border:0;border-radius:999px;background:#4535c9;color:#fff">Réessayer</button>
            <button onclick="PagioAdmin.forgetCertificate()" style="font-size:15px;padding:10px 16px;margin-left:8px;border:1px solid #ccc;border-radius:999px;background:#fff">Choisir un autre certificat</button>
            </body></html>""".trimIndent()
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    /** Pont appelé par le tableau de bord (window.PagioAdmin) : clé de notification, téléchargements, page d'aide. */
    private inner class Bridge {
        @JavascriptInterface fun hasNotifyKey(): Boolean = store.notifyKey != null

        @JavascriptInterface fun setNotifyKey(token: String, adminEmail: String) {
            store.resetNotifications()
            store.notifyKey = token; store.adminEmail = adminEmail
            NotifyJob.schedule(this@MainActivity)
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
            }
            thread { runCatching { NotifyJob.check(applicationContext) } } // première lecture : rien d'ancien n'est notifié
        }

        @JavascriptInterface fun deviceName(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(60)

        /** Téléchargement (export CSV, sauvegarde) : le fichier arrive en base64 et va dans Téléchargements. */
        @JavascriptInterface fun saveFile(name: String, mime: String, base64: String) {
            val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "pagio" }
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val where = runCatching {
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, safe); put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Pagio Admin")
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("refusé")
                    contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                    "Téléchargements/Pagio Admin/$safe"
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)!!.apply { mkdirs() }
                    File(dir, safe).writeBytes(bytes); File(dir, safe).absolutePath
                }
            }.getOrElse { "échec : ${it.message}" }
            runOnUiThread { Toast.makeText(this@MainActivity, getString(R.string.saved_download, where), Toast.LENGTH_LONG).show() }
        }

        @JavascriptInterface fun retry() = runOnUiThread { web.loadUrl(home) }

        @JavascriptInterface fun forgetCertificate() = runOnUiThread { store.certAlias = null; web.clearSslPreferences(); WebView.clearClientCertPreferences(null); web.loadUrl(home) }
    }
}
