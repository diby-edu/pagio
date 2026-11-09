package com.pagio.app

import android.app.Application
import android.content.Context
import com.pagio.ai.AiProviders
import com.pagio.ai.DocumentAssistant
import com.pagio.ai.LanguageDetector
import com.pagio.ai.OcrService
import com.pagio.ai.OnDeviceTranslator
import com.pagio.app.data.HistoryDb
import com.pagio.app.data.SettingsStore
import com.pagio.app.data.Workspace
import com.pagio.cloud.Account
import com.pagio.cloud.BackendException
import com.pagio.cloud.PagioBackend
import com.pagio.cloud.RemoteConfig
import com.pagio.engine.PagioEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.Collections

class PagioApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        PagioEngine.init(this)
        container = AppContainer(this)
        container.start()
    }
}

val Context.container: AppContainer get() = (applicationContext as PagioApp).container

enum class ServerState { UNKNOWN, ONLINE, OFFLINE, NOT_CONFIGURED }

/** Dépendances partagées de l'application (injection manuelle, simple et lisible). */
class AppContainer(val context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val settings = SettingsStore(context)
    val history = HistoryDb(context)
    val workspace = Workspace(context)
    val backend = PagioBackend(BuildConfig.DEFAULT_SERVER_URL)
    val ocr by lazy { OcrService() }
    val languages by lazy { LanguageDetector() }
    val translator by lazy { OnDeviceTranslator() }

    private val _config = MutableStateFlow(RemoteConfig())
    val config: StateFlow<RemoteConfig> = _config
    private val _account = MutableStateFlow<Account?>(null)
    val account: StateFlow<Account?> = _account
    private val _server = MutableStateFlow(ServerState.UNKNOWN)
    val server: StateFlow<ServerState> = _server

    private val pendingEvents = Collections.synchronizedList(mutableListOf<JSONObject>())

    fun start() {
        scope.launch {
            history.refresh()
            workspace.cleanTemp(olderThanMs = 6 * 3600_000L) // restes d'une session interrompue
            settings.cachedRemoteConfig()?.let { runCatching { _config.value = RemoteConfig.parse(JSONObject(it), 0) } }
            refreshServer()
            track("app_open")
        }
    }

    suspend fun refreshServer() {
        val s = settings.current()
        backend.baseUrl = s.serverUrl
        backend.token = settings.token()
        if (s.serverUrl.isBlank()) { _server.value = ServerState.NOT_CONFIGURED; return }
        try {
            val cfg = backend.config(BuildConfig.VERSION_CODE)
            _config.value = cfg
            _server.value = ServerState.ONLINE
            settings.cacheRemoteConfig(rawConfig(cfg))
            if (backend.token != null) {
                _account.value = try { backend.me() } catch (e: BackendException) {
                    if (e.status == 401) { settings.setToken(null); backend.token = null }
                    null
                }
            }
            flushEvents()
        } catch (e: BackendException) {
            _server.value = ServerState.OFFLINE
        }
    }

    private fun rawConfig(c: RemoteConfig): String {
        // On ne conserve que ce qui sert hors ligne (outils désactivés, quotas, annonce).
        val tools = JSONObject()
        c.tools.forEach { (k, v) -> tools.put(k, JSONObject().put("enabled", v.enabled).put("premium", v.premium).put("max_files", v.maxFiles).put("max_mb", v.maxMb)) }
        fun lim(l: com.pagio.cloud.PlanLimits) = JSONObject().put("daily_tasks", l.dailyTasks).put("max_files", l.maxFiles).put("max_mb", l.maxMb).put("ai_credits", l.aiCredits)
        return JSONObject().put("tools", tools).put("announcement", c.announcement).put("announcement_level", c.announcementLevel)
            .put("min_version_code", c.minVersionCode).put("latest_version_name", c.latestVersionName).put("update_url", c.updateUrl)
            .put("plans", JSONObject().put("free", lim(c.freeLimits)).put("premium", lim(c.premiumLimits)))
            .put("ai_enabled", c.aiEnabled).put("server_conversion", c.serverConversion).put("support_email", c.supportEmail).toString()
    }

    suspend fun login(email: String, password: String, register: Boolean, name: String = ""): Account {
        backend.baseUrl = settings.current().serverUrl
        val acc = if (register) backend.register(email, password, name) else backend.login(email, password)
        settings.setToken(backend.token)
        _account.value = acc
        return acc
    }

    suspend fun logout() { settings.setToken(null); backend.token = null; _account.value = null }

    suspend fun reloadAccount() { if (backend.token != null) runCatching { _account.value = backend.me() } }

    suspend fun deleteAccount() { backend.deleteAccount(); logout() }

    /** Assistant IA selon les réglages (clé personnelle) ou les crédits du serveur Pagio. */
    suspend fun assistant(): DocumentAssistant {
        val s = settings.current()
        val provider = AiProviders.create(s.ai, s.serverUrl, settings.token())
        return DocumentAssistant(provider)
    }

    /** Statistiques d'usage anonymes, seulement si l'utilisateur l'a accepté. */
    fun track(name: String, props: Map<String, Any?> = emptyMap()) {
        scope.launch {
            if (!settings.current().telemetry) return@launch
            val o = JSONObject().put("name", name).put("ts", System.currentTimeMillis())
            val p = JSONObject(); props.forEach { (k, v) -> p.put(k, v) }
            o.put("props", p)
            pendingEvents += o
            if (pendingEvents.size >= 10 || name == "app_open") flushEvents()
        }
    }

    suspend fun flushEvents() {
        val s = settings.current()
        if (!s.telemetry || _server.value != ServerState.ONLINE) return
        val batch = synchronized(pendingEvents) { pendingEvents.toList().also { pendingEvents.clear() } }
        if (batch.isEmpty()) return
        runCatching { backend.sendEvents(settings.ensureDeviceId(), BuildConfig.VERSION_NAME, batch) }
            .onFailure { pendingEvents.addAll(batch) }
    }
}
