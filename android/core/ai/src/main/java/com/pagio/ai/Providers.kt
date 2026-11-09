package com.pagio.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ChatMessage(val role: String, val content: String) // role : "user" | "assistant"

/** Types de fournisseurs pris en charge. Ajouter un fournisseur = une classe + une entrée ici. */
enum class ProviderType(val label: String, val defaultBaseUrl: String, val defaultModel: String) {
    PAGIO_SERVER("Serveur Pagio (crédits IA)", "", "auto"),
    OPENAI_COMPATIBLE("OpenAI / Mistral / Groq / Ollama (compatible OpenAI)", "https://api.openai.com/v1", "gpt-4.1-mini"),
    ANTHROPIC("Anthropic Claude", "https://api.anthropic.com/v1", "claude-haiku-5-5"),
    GEMINI("Google Gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-2.5-flash"),
    NONE("Aucun (analyses hors ligne uniquement)", "", ""),
}

data class AiConfig(
    val type: ProviderType = ProviderType.NONE,
    val baseUrl: String = "",
    val apiKey: String = "",
    val model: String = "",
    val temperature: Double = 0.3,
    val maxOutputTokens: Int = 1800,
)

/** Contrat commun à tous les fournisseurs d'IA générative. */
interface AiProvider {
    val name: String
    suspend fun complete(system: String, messages: List<ChatMessage>): String
}

object AiProviders {
    /** [serverToken] et [serverUrl] servent au fournisseur « Serveur Pagio ». */
    fun create(config: AiConfig, serverUrl: String? = null, serverToken: String? = null): AiProvider? = when (config.type) {
        ProviderType.NONE -> null
        ProviderType.OPENAI_COMPATIBLE -> OpenAiCompatibleProvider(config)
        ProviderType.ANTHROPIC -> AnthropicProvider(config)
        ProviderType.GEMINI -> GeminiProvider(config)
        ProviderType.PAGIO_SERVER -> if (serverUrl.isNullOrBlank()) null else PagioServerProvider(serverUrl, serverToken, config)
    }
}

internal object Http {
    suspend fun postJson(url: String, body: JSONObject, headers: Map<String, String>, timeoutMs: Int = 120_000): JSONObject =
        withContext(Dispatchers.IO) {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"; doOutput = true
                connectTimeout = 20_000; readTimeout = timeoutMs
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
            }
            try {
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
                if (code !in 200..299) throw AiException(humanError(code, text))
                JSONObject(text)
            } catch (e: AiException) { throw e } catch (e: java.net.UnknownHostException) {
                throw AiException("Pas de connexion Internet : l'IA en ligne est indisponible. Les analyses hors ligne restent utilisables.", e)
            } catch (e: java.net.SocketTimeoutException) {
                throw AiException("Le fournisseur d'IA ne répond pas (délai dépassé). Réessayez plus tard.", e)
            } catch (e: Exception) {
                throw AiException("Erreur de communication avec l'IA : ${e.message}", e)
            } finally { conn.disconnect() }
        }

    private fun humanError(code: Int, body: String): String {
        val detail = runCatching {
            val j = JSONObject(body)
            j.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() } ?: j.optString("error").takeIf { it.isNotBlank() } ?: j.optString("message")
        }.getOrNull().orEmpty().take(300)
        return when (code) {
            401, 403 -> "Clé d'API refusée ou accès interdit. Vérifiez la clé dans Réglages > Intelligence artificielle. $detail"
            402 -> "Crédits IA épuisés. $detail"
            404 -> "Modèle ou adresse introuvable. Vérifiez le nom du modèle. $detail"
            429 -> "Trop de requêtes ou quota atteint chez le fournisseur. $detail"
            in 500..599 -> "Le service d'IA rencontre un problème ($code). $detail"
            else -> "Erreur IA ($code). $detail"
        }.trim()
    }
}

class OpenAiCompatibleProvider(private val c: AiConfig) : AiProvider {
    override val name = "Compatible OpenAI"
    override suspend fun complete(system: String, messages: List<ChatMessage>): String {
        val msgs = JSONArray().put(JSONObject().put("role", "system").put("content", system))
        messages.forEach { msgs.put(JSONObject().put("role", it.role).put("content", it.content)) }
        val body = JSONObject().put("model", c.model.ifBlank { ProviderType.OPENAI_COMPATIBLE.defaultModel })
            .put("messages", msgs).put("temperature", c.temperature).put("max_tokens", c.maxOutputTokens)
        val headers = if (c.apiKey.isNotBlank()) mapOf("Authorization" to "Bearer ${c.apiKey}") else emptyMap()
        val base = c.baseUrl.ifBlank { ProviderType.OPENAI_COMPATIBLE.defaultBaseUrl }.trimEnd('/')
        val res = Http.postJson("$base/chat/completions", body, headers)
        return res.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content").trim()
    }
}

class AnthropicProvider(private val c: AiConfig) : AiProvider {
    override val name = "Anthropic Claude"
    override suspend fun complete(system: String, messages: List<ChatMessage>): String {
        val msgs = JSONArray()
        messages.forEach { msgs.put(JSONObject().put("role", it.role).put("content", it.content)) }
        val body = JSONObject().put("model", c.model.ifBlank { ProviderType.ANTHROPIC.defaultModel })
            .put("system", system).put("messages", msgs).put("max_tokens", c.maxOutputTokens).put("temperature", c.temperature)
        val base = c.baseUrl.ifBlank { ProviderType.ANTHROPIC.defaultBaseUrl }.trimEnd('/')
        val res = Http.postJson("$base/messages", body, mapOf("x-api-key" to c.apiKey, "anthropic-version" to "2023-06-01"))
        val content = res.getJSONArray("content")
        return (0 until content.length()).map { content.getJSONObject(it) }.filter { it.optString("type") == "text" }
            .joinToString("") { it.getString("text") }.trim()
    }
}

class GeminiProvider(private val c: AiConfig) : AiProvider {
    override val name = "Google Gemini"
    override suspend fun complete(system: String, messages: List<ChatMessage>): String {
        val contents = JSONArray()
        messages.forEach {
            contents.put(JSONObject().put("role", if (it.role == "assistant") "model" else "user")
                .put("parts", JSONArray().put(JSONObject().put("text", it.content))))
        }
        val body = JSONObject().put("contents", contents)
            .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
            .put("generationConfig", JSONObject().put("temperature", c.temperature).put("maxOutputTokens", c.maxOutputTokens))
        val base = c.baseUrl.ifBlank { ProviderType.GEMINI.defaultBaseUrl }.trimEnd('/')
        val model = c.model.ifBlank { ProviderType.GEMINI.defaultModel }
        val res = Http.postJson("$base/models/$model:generateContent", body, mapOf("x-goog-api-key" to c.apiKey))
        val parts = res.getJSONArray("candidates").getJSONObject(0).getJSONObject("content").getJSONArray("parts")
        return (0 until parts.length()).joinToString("") { parts.getJSONObject(it).optString("text") }.trim()
    }
}

/**
 * Passe par le serveur Pagio : les clés d'API restent sur le serveur, l'administrateur choisit
 * le modèle et décompte les crédits IA de chaque utilisateur.
 */
class PagioServerProvider(private val serverUrl: String, private val token: String?, private val c: AiConfig) : AiProvider {
    override val name = "Serveur Pagio"
    var lastCreditsLeft: Int? = null
        private set

    override suspend fun complete(system: String, messages: List<ChatMessage>): String {
        if (token.isNullOrBlank()) throw AiException("Connectez-vous à votre compte Pagio pour utiliser les crédits IA du serveur.")
        val msgs = JSONArray()
        messages.forEach { msgs.put(JSONObject().put("role", it.role).put("content", it.content)) }
        val body = JSONObject().put("system", system).put("messages", msgs).put("max_tokens", c.maxOutputTokens)
        val res = Http.postJson("${serverUrl.trimEnd('/')}/api/ai/complete", body, mapOf("Authorization" to "Bearer $token"))
        lastCreditsLeft = if (res.has("credits_left")) res.optInt("credits_left") else null
        return res.getString("text").trim()
    }
}
