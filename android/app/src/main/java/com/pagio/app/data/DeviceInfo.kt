package com.pagio.app.data

import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.telephony.TelephonyManager
import java.util.Locale
import java.util.TimeZone

/**
 * Description de l'appareil jointe à l'événement « app_open » (statistiques d'usage, prévues dans les conditions
 * d'utilisation) : marque, modèle, version d'Android, écran, langue, pays, fuseau horaire, origine de l'installation.
 * Aucune donnée personnelle : ni numéro, ni identifiant publicitaire, ni position précise (le pays vient du réseau
 * mobile, de la carte SIM ou à défaut de la langue du téléphone, sans aucune permission).
 */
object DeviceInfo {
    private const val PREFS = "pagio-stats"

    fun describe(context: Context): Map<String, Any?> {
        val cfg = context.resources.configuration
        val metrics = context.resources.displayMetrics
        val locale = cfg.locales[0] ?: Locale.getDefault()
        return mapOf(
            "brand" to Build.MANUFACTURER.take(40),
            "model" to Build.MODEL.take(60),
            "android" to Build.VERSION.RELEASE.take(12),
            "sdk" to Build.VERSION.SDK_INT,
            "screen_dp" to "${cfg.screenWidthDp}x${cfg.screenHeightDp}",
            "density" to metrics.densityDpi,
            "tablet" to ((cfg.screenLayout and Configuration.SCREENLAYOUT_SIZE_MASK) >= Configuration.SCREENLAYOUT_SIZE_LARGE),
            "lang" to locale.language.take(8),
            "country" to country(context, locale),
            "tz" to TimeZone.getDefault().id.take(40),
            "installer" to installer(context),
            "first_open" to firstOpen(context),
            "dark" to ((cfg.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES),
        )
    }

    /** Pays : réseau mobile, puis carte SIM, puis réglage de langue du téléphone (code à 2 lettres, ex. « CI »). */
    private fun country(context: Context, locale: Locale): String? {
        val tm = runCatching { context.getSystemService(TelephonyManager::class.java) }.getOrNull()
        val code = listOfNotNull(runCatching { tm?.networkCountryIso }.getOrNull(), runCatching { tm?.simCountryIso }.getOrNull(), locale.country)
            .firstOrNull { it.length == 2 }
        return code?.uppercase(Locale.ROOT)
    }

    /** D'où vient l'application : Play Store, site (fichier APK), autre magasin. */
    private fun installer(context: Context): String = runCatching {
        val pm = context.packageManager
        val src = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) pm.getInstallSourceInfo(context.packageName).installingPackageName
        else @Suppress("DEPRECATION") pm.getInstallerPackageName(context.packageName)
        when (src) {
            null -> "apk"
            "com.android.vending" -> "play_store"
            else -> src.take(60)
        }
    }.getOrDefault("unknown")

    /** Vrai seulement lors de la toute première ouverture après installation (compte des installations). */
    private fun firstOpen(context: Context): Boolean {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (p.getBoolean("opened", false)) return false
        p.edit().putBoolean("opened", true).apply()
        return true
    }
}
