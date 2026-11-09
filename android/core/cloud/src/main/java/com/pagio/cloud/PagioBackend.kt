package com.pagio.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Réglages d'un outil pilotés depuis le tableau de bord admin. */
data class ToolFlag(val enabled: Boolean = true, val premium: Boolean = false, val maxFiles: Int = 0, val maxMb: Int = 0)

data class PlanLimits(val dailyTasks: Int = 0, val maxFiles: Int = 0, val maxMb: Int = 0, val aiCredits: Int = 0)

/** Configuration distante de l'application. Valeurs par défaut = fonctionnement hors ligne complet. */
data class RemoteConfig(
    val maintenance: Boolean = false,
    val maintenanceMessage: String = "",
    val announcement: String = "",
    val announcementLevel: String = "info",
    val minVersionCode: Int = 0,
    val latestVersionName: String = "",
    val updateUrl: String = "",
    val tools: Map<String, ToolFlag> = emptyMap(),
    val freeLimits: PlanLimits = PlanLimits(),
    val premiumLimits: PlanLimits = PlanLimits(),
    val aiEnabled: Boolean = false,
    val serverConversion: Boolean = false,
    val supportEmail: String = "",
    val fetchedAt: Long = 0,
) {
    fun tool(id: String): ToolFlag = tools[id] ?: ToolFlag()

    companion object {
        fun parse(json: JSONObject, fetchedAt: Long = System.currentTimeMillis()): RemoteConfig {
            val tools = HashMap<String, ToolFlag>()
            json.optJSONObject("tools")?.let { t ->
                t.keys().forEach { k ->
                    val o = t.getJSONObject(k)
                    tools[k] = ToolFlag(o.optBoolean("enabled", true), o.optBoolean("premium", false), o.optInt("max_files", 0), o.optInt("max_mb", 0))
                }
            }
            fun limits(o: JSONObject?) = if (o == null) PlanLimits() else PlanLimits(o.optInt("daily_tasks"), o.optInt("max_files"), o.optInt("max_mb"), o.optInt("ai_credits"))
            val plans = json.optJSONObject("plans")
            return RemoteConfig(
                maintenance = json.optBoolean("maintenance"),
                maintenanceMessage = json.optString("maintenance_message"),
                announcement = json.optString("announcement"),
                announcementLevel = json.optString("announcement_level", "info"),
                minVersionCode = json.optInt("min_version_code"),
                latestVersionName = json.optString("latest_version_name"),
                updateUrl = json.optString("update_url"),
                tools = tools,
                freeLimits = limits(plans?.optJSONObject("free")),
                premiumLimits = limits(plans?.optJSONObject("premium")),
                aiEnabled = json.optBoolean("ai_enabled"),
                serverConversion = json.optBoolean("server_conversion"),
                supportEmail = json.optString("support_email"),
                fetchedAt = fetchedAt,
            )
        }
    }
}

data class Account(val id: String, val email: String, val name: String, val plan: String, val aiCredits: Int,
                   val tasksToday: Int, val premiumUntil: String?) {
    val isPremium: Boolean get() = plan == "premium"

    companion object {
        fun parse(o: JSONObject) = Account(
            o.getString("id"), o.getString("email"), o.optString("name"), o.optString("plan", "free"),
            o.optInt("ai_credits"), o.optInt("tasks_today"), o.optString("premium_until").ifBlank { null },
        )
    }
}

class BackendException(val status: Int, message: String) : Exception(message)

/**
 * Client du serveur Pagio. Toutes les fonctionnalités PDF marchent sans lui : il apporte les comptes,
 * l'offre Premium, les crédits IA, la configuration à distance, les statistiques et les conversions haute fidélité.
 */
class PagioBackend(var baseUrl: String, var token: String? = null) {

    private fun url(path: String) = baseUrl.trimEnd('/') + path

    private suspend fun request(method: String, path: String, body: JSONObject? = null, auth: Boolean = false, timeoutMs: Int = 15_000): JSONObject =
        withContext(Dispatchers.IO) {
            if (baseUrl.isBlank()) throw BackendException(0, "Aucun serveur configuré")
            val conn = (URL(url(path)).openConnection() as HttpURLConnection).apply {
                requestMethod = method; connectTimeout = 8_000; readTimeout = timeoutMs
                setRequestProperty("Accept", "application/json")
                if (auth && token != null) setRequestProperty("Authorization", "Bearer $token")
                if (body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json; charset=utf-8") }
            }
            try {
                body?.let { b -> conn.outputStream.use { it.write(b.toString().toByteArray(Charsets.UTF_8)) } }
                val code = conn.responseCode
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
                val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
                if (code !in 200..299) throw BackendException(code, json.optString("error").ifBlank { "Erreur serveur ($code)" })
                json
            } catch (e: BackendException) { throw e } catch (e: Exception) {
                throw BackendException(0, "Serveur injoignable : ${e.message ?: "connexion impossible"}")
            } finally { conn.disconnect() }
        }

    suspend fun health(): Boolean = runCatching { request("GET", "/api/health").optBoolean("ok") }.getOrDefault(false)

    suspend fun config(appVersion: Int, platform: String = "android"): RemoteConfig =
        RemoteConfig.parse(request("GET", "/api/app/config?version=$appVersion&platform=$platform"))

    suspend fun register(email: String, password: String, name: String): Account {
        val res = request("POST", "/api/auth/register", JSONObject().put("email", email).put("password", password).put("name", name))
        token = res.getString("token"); return Account.parse(res.getJSONObject("user"))
    }

    suspend fun login(email: String, password: String): Account {
        val res = request("POST", "/api/auth/login", JSONObject().put("email", email).put("password", password))
        token = res.getString("token"); return Account.parse(res.getJSONObject("user"))
    }

    suspend fun me(): Account = Account.parse(request("GET", "/api/me", auth = true).getJSONObject("user"))

    suspend fun requestPasswordReset(email: String): String =
        request("POST", "/api/auth/forgot", JSONObject().put("email", email)).optString("message")

    suspend fun deleteAccount() { request("DELETE", "/api/me", auth = true) }

    /** Demande au serveur s'il reste des tâches au quota du jour (offre gratuite). */
    suspend fun consumeTask(tool: String, files: Int, totalBytes: Long): JSONObject =
        request("POST", "/api/me/tasks", JSONObject().put("tool", tool).put("files", files).put("bytes", totalBytes), auth = true)

    /** Envoie un lot d'événements anonymes (statistiques d'usage), si l'utilisateur l'a accepté. */
    suspend fun sendEvents(deviceId: String, appVersion: String, events: List<JSONObject>) {
        if (events.isEmpty()) return
        val arr = JSONArray(); events.forEach { arr.put(it) }
        request("POST", "/api/app/events", JSONObject().put("device_id", deviceId).put("app_version", appVersion).put("events", arr), auth = token != null)
    }

    suspend fun feedback(kind: String, message: String, email: String?) {
        request("POST", "/api/app/feedback", JSONObject().put("kind", kind).put("message", message).put("email", email ?: ""), auth = token != null)
    }

    /**
     * Conversion haute fidélité sur le serveur (LibreOffice) : Word/Excel/PowerPoint/ODF → PDF,
     * et PDF → DOCX. Le fichier est supprimé du serveur juste après la conversion.
     */
    suspend fun convert(input: File, target: String, output: File, onProgress: (Float) -> Unit = {}): File = withContext(Dispatchers.IO) {
        if (baseUrl.isBlank()) throw BackendException(0, "Aucun serveur configuré")
        val conn = (URL(url("/api/convert?to=$target&name=" + URLEncoder.encode(input.name, "UTF-8"))).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; connectTimeout = 10_000; readTimeout = 300_000
            setRequestProperty("Content-Type", "application/octet-stream")
            setFixedLengthStreamingMode(input.length())
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            conn.outputStream.use { os ->
                input.inputStream().use { ins ->
                    val buf = ByteArray(64 * 1024); var sent = 0L; var n: Int
                    while (ins.read(buf).also { n = it } > 0) { os.write(buf, 0, n); sent += n; onProgress(0.7f * sent / input.length()) }
                }
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                val msg = conn.errorStream?.bufferedReader()?.use { it.readText() }?.let { runCatching { JSONObject(it).optString("error") }.getOrNull() }
                throw BackendException(code, msg?.ifBlank { null } ?: "Conversion refusée par le serveur ($code)")
            }
            conn.inputStream.use { ins -> FileOutputStream(output).use { ins.copyTo(it) } }
            onProgress(1f)
            output
        } catch (e: BackendException) { throw e } catch (e: Exception) {
            throw BackendException(0, "Conversion en ligne impossible : ${e.message}")
        } finally { conn.disconnect() }
    }
}
