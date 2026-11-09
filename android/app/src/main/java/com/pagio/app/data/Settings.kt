package com.pagio.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.pagio.ai.AiConfig
import com.pagio.ai.ProviderType
import com.pagio.app.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.dataStore by preferencesDataStore(name = "pagio_settings")

enum class ThemeMode { SYSTEM, LIGHT, DARK }

data class AppSettings(
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val dynamicColor: Boolean = false,
    val serverUrl: String = BuildConfig.DEFAULT_SERVER_URL,
    val telemetry: Boolean = false,
    val onboardingDone: Boolean = false,
    val favorites: List<String> = listOf("merge", "compress", "edit", "assistant"),
    val ai: AiConfig = AiConfig(),
    val deviceId: String = "",
    val autoSaveToDownloads: Boolean = false,
)

/**
 * Réglages persistants. Les secrets (clé d'API, jeton de session) sont chiffrés avec une clé
 * AES-256 stockée dans le Keystore matériel d'Android : ils ne sont jamais lisibles en clair sur le disque.
 */
class SettingsStore(private val context: Context) {
    private object K {
        val theme = stringPreferencesKey("theme")
        val dynamic = booleanPreferencesKey("dynamic_color")
        val server = stringPreferencesKey("server_url")
        val telemetry = booleanPreferencesKey("telemetry")
        val onboarding = booleanPreferencesKey("onboarding_done")
        val favorites = stringPreferencesKey("favorites")
        val aiType = stringPreferencesKey("ai_type")
        val aiBase = stringPreferencesKey("ai_base_url")
        val aiModel = stringPreferencesKey("ai_model")
        val aiKey = stringPreferencesKey("ai_key_enc")
        val token = stringPreferencesKey("session_token_enc")
        val device = stringPreferencesKey("device_id")
        val autoSave = booleanPreferencesKey("auto_save_downloads")
        val remoteConfig = stringPreferencesKey("remote_config_json")
        val tasksDay = stringPreferencesKey("tasks_day")
    }

    val settings: Flow<AppSettings> = context.dataStore.data.map { p -> read(p) }

    suspend fun current(): AppSettings = settings.first()

    private fun read(p: Preferences) = AppSettings(
        theme = runCatching { ThemeMode.valueOf(p[K.theme] ?: "SYSTEM") }.getOrDefault(ThemeMode.SYSTEM),
        dynamicColor = p[K.dynamic] ?: false,
        serverUrl = p[K.server] ?: BuildConfig.DEFAULT_SERVER_URL,
        telemetry = p[K.telemetry] ?: false,
        onboardingDone = p[K.onboarding] ?: false,
        favorites = p[K.favorites]?.split(',')?.filter { it.isNotBlank() } ?: AppSettings().favorites,
        ai = AiConfig(
            type = runCatching { ProviderType.valueOf(p[K.aiType] ?: "NONE") }.getOrDefault(ProviderType.NONE),
            baseUrl = p[K.aiBase] ?: "",
            apiKey = p[K.aiKey]?.let { Secrets.decrypt(it) } ?: "",
            model = p[K.aiModel] ?: "",
        ),
        deviceId = p[K.device] ?: "",
        autoSaveToDownloads = p[K.autoSave] ?: false,
    )

    suspend fun ensureDeviceId(): String {
        val existing = current().deviceId
        if (existing.isNotBlank()) return existing
        val id = UUID.randomUUID().toString()
        context.dataStore.edit { it[K.device] = id }
        return id
    }

    suspend fun setTheme(mode: ThemeMode) = context.dataStore.edit { it[K.theme] = mode.name }
    suspend fun setDynamicColor(on: Boolean) = context.dataStore.edit { it[K.dynamic] = on }
    suspend fun setServerUrl(url: String) = context.dataStore.edit { it[K.server] = url.trim() }
    suspend fun setTelemetry(on: Boolean) = context.dataStore.edit { it[K.telemetry] = on }
    suspend fun setOnboardingDone() = context.dataStore.edit { it[K.onboarding] = true }
    suspend fun setAutoSave(on: Boolean) = context.dataStore.edit { it[K.autoSave] = on }
    suspend fun setFavorites(ids: List<String>) = context.dataStore.edit { it[K.favorites] = ids.distinct().joinToString(",") }

    suspend fun setAi(config: AiConfig) = context.dataStore.edit {
        it[K.aiType] = config.type.name
        it[K.aiBase] = config.baseUrl.trim()
        it[K.aiModel] = config.model.trim()
        if (config.apiKey.isBlank()) it.remove(K.aiKey) else it[K.aiKey] = Secrets.encrypt(config.apiKey.trim())
    }

    suspend fun token(): String? = context.dataStore.data.first()[K.token]?.let { Secrets.decrypt(it) }?.ifBlank { null }
    suspend fun setToken(token: String?) = context.dataStore.edit {
        if (token.isNullOrBlank()) it.remove(K.token) else it[K.token] = Secrets.encrypt(token)
    }

    suspend fun cachedRemoteConfig(): String? = context.dataStore.data.first()[K.remoteConfig]
    suspend fun cacheRemoteConfig(json: String) = context.dataStore.edit { it[K.remoteConfig] = json }

    /** Compteur local de tâches du jour (quota de l'offre gratuite défini par l'administrateur). */
    suspend fun tasksToday(): Int {
        val raw = context.dataStore.data.first()[K.tasksDay] ?: return 0
        val (day, n) = raw.split(':').let { it[0] to (it.getOrNull(1)?.toIntOrNull() ?: 0) }
        return if (day == today()) n else 0
    }

    suspend fun incrementTasks() {
        val n = tasksToday() + 1
        context.dataStore.edit { it[K.tasksDay] = "${today()}:$n" }
    }

    private fun today() = java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.ROOT).format(java.util.Date())
}

/** Chiffrement AES-GCM avec une clé non exportable du Keystore Android. */
object Secrets {
    private const val ALIAS = "pagio_secrets_v1"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return gen.generateKey()
    }

    fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val data = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(data, Base64.NO_WRAP)
    }

    fun decrypt(stored: String): String? = runCatching {
        val (iv, data) = stored.split(':')
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        }
        String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
    }.getOrNull()
}
