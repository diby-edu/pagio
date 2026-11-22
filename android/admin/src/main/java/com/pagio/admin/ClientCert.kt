package com.pagio.admin

import android.content.Context
import android.security.KeyChain
import java.net.Socket
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509KeyManager

/**
 * Certificat d'appareil : admin.pagio.site n'accepte que les téléphones dont le certificat (fichier .p12 créé sur le VPS
 * par admin-appareils.sh) est installé dans le coffre de certificats d'Android. L'utilisateur l'autorise une fois pour
 * Pagio Admin ; la clé privée reste dans le coffre (souvent la puce de sécurité du téléphone) et n'est jamais copiée.
 */
object ClientCert {
    class Material(val key: PrivateKey, val chain: Array<X509Certificate>)

    /** À appeler hors du fil principal. null si aucun certificat n'a été autorisé, ou s'il a été supprimé du téléphone. */
    fun load(context: Context): Material? {
        val alias = Store(context).certAlias ?: return null
        return runCatching {
            val key = KeyChain.getPrivateKey(context, alias) ?: return null
            val chain = KeyChain.getCertificateChain(context, alias) ?: return null
            Material(key, chain)
        }.getOrNull()
    }

    /** Connexions HTTPS des vérifications en arrière-plan, présentées avec le certificat d'appareil. */
    fun socketFactory(m: Material): SSLSocketFactory {
        val km = object : X509KeyManager {
            override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?) = "appareil"
            override fun getCertificateChain(alias: String?) = m.chain
            override fun getPrivateKey(alias: String?) = m.key
            override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf("appareil")
            override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?) = null
            override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?) = null
        }
        return SSLContext.getInstance("TLS").apply { init(arrayOf(km), null, null) }.socketFactory
    }
}
