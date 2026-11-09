package com.pagio.app.ui.tool

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.pagio.ai.AiException
import com.pagio.app.container
import com.pagio.app.data.PickedFile
import com.pagio.app.tools.Tool
import com.pagio.app.tools.ToolInputException
import com.pagio.app.tools.ToolOptions
import com.pagio.app.tools.ToolResult
import com.pagio.app.tools.ToolRunner
import com.pagio.cloud.BackendException
import com.pagio.engine.EngineError
import com.pagio.engine.EngineException
import com.pagio.engine.PdfSecurity
import com.pagio.engine.TaskContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

sealed interface TaskState {
    data object Idle : TaskState
    data class Running(val progress: Float?, val message: String?) : TaskState
    data class Done(val result: ToolResult) : TaskState
    data class Failed(val message: String) : TaskState
}

/** Passage de fichiers d'un outil à l'autre (« Continuer avec… »). */
object Handoff {
    var files: List<PickedFile> = emptyList()
    fun take(): List<PickedFile> = files.also { files = emptyList() }
}

fun humanError(e: Throwable): String = when (e) {
    is CancellationException -> "Traitement annulé."
    is ToolInputException -> e.message ?: "Paramètres incorrects."
    is EngineException -> e.message ?: "Erreur de traitement."
    is BackendException -> e.message ?: "Erreur du serveur."
    is AiException -> e.message ?: "Erreur de l'IA."
    is OutOfMemoryError -> "Document trop volumineux pour la mémoire de cet appareil. Essayez de le diviser ou de le compresser d'abord."
    is SecurityException -> "Accès au fichier refusé par le système."
    is java.io.IOException -> "Erreur de lecture/écriture : ${e.message}"
    else -> "Erreur inattendue : ${e.message ?: e.javaClass.simpleName}"
}

class ToolViewModel(app: Application, val tool: Tool) : AndroidViewModel(app) {
    private val c = app.container
    private val runner = ToolRunner(c)
    val files = mutableStateListOf<PickedFile>()
    var options by mutableStateOf(ToolOptions())
    var state by mutableStateOf<TaskState>(TaskState.Idle)
        private set
    var passwordFor by mutableStateOf<PickedFile?>(null)
        private set
    var passwordError by mutableStateOf<String?>(null)
        private set
    var importing by mutableStateOf(false)
        private set
    private var job: Job? = null
    private var startedAt = 0L

    init {
        val handed = Handoff.take().filter { accepts(it) }
        files.addAll(if (tool.multiple) handed else handed.take(1))
        handed.firstOrNull()?.let { afterAdd(it) }
    }

    private fun accepts(f: PickedFile): Boolean = when (tool.input) {
        com.pagio.app.tools.InputKind.PDF -> f.isPdf
        com.pagio.app.tools.InputKind.IMAGES -> f.isImage
        else -> true
    }

    fun addUris(uris: List<Uri>) {
        if (uris.isEmpty()) return
        importing = true
        viewModelScope.launch {
            try {
                val dir = c.workspace.newTaskDir()
                val picked = uris.map { c.workspace.import(it, dir) }
                if (!tool.multiple) files.clear()
                files.addAll(if (tool.multiple) picked else picked.take(1))
                picked.forEach { afterAdd(it) }
                if (state is TaskState.Done || state is TaskState.Failed) state = TaskState.Idle
            } catch (e: Exception) {
                state = TaskState.Failed(humanError(e))
            } finally { importing = false }
        }
    }

    fun addFile(f: PickedFile) { if (!tool.multiple) files.clear(); files.add(f); afterAdd(f) }

    private fun afterAdd(f: PickedFile) {
        if (!f.isPdf) return
        viewModelScope.launch {
            val encrypted = withContext(Dispatchers.IO) { runCatching { PdfSecurity.isEncrypted(f.file) }.getOrDefault(false) }
            if (encrypted && f.password == null && tool != Tool.UNLOCK) { passwordError = null; passwordFor = f }
            if (tool == Tool.METADATA && !options.metaLoaded) {
                withContext(Dispatchers.IO) { ToolRunner.loadMetadata(f) }?.let { m ->
                    options = options.copy(metaTitle = m.metaTitle, metaAuthor = m.metaAuthor, metaSubject = m.metaSubject, metaKeywords = m.metaKeywords, metaLoaded = true)
                }
            }
        }
    }

    fun submitPassword(pw: String) {
        val f = passwordFor ?: return
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) {
                try { com.pagio.engine.openPdf(f.file, pw).close(); true } catch (e: EngineException) { false }
            }
            if (ok) { f.password = pw; passwordFor = null; passwordError = null; afterAdd(f) }
            else passwordError = "Mot de passe incorrect."
        }
    }

    fun dismissPassword() {
        passwordFor?.let { files.remove(it) }
        passwordFor = null
    }

    fun remove(f: PickedFile) { files.remove(f) }
    fun move(from: Int, to: Int) { if (from in files.indices && to in files.indices) files.add(to, files.removeAt(from)) }
    fun reset() { state = TaskState.Idle }

    fun run(htmlRenderer: (suspend (TaskContext) -> ToolResult)? = null) {
        if (state is TaskState.Running) return
        startedAt = System.currentTimeMillis()
        state = TaskState.Running(null, null)
        job = viewModelScope.launch {
            val current = coroutineContext
            try {
                runner.validate(tool, files, options)
                val ctx = TaskContext(
                    onProgress = { p, m -> state = TaskState.Running(p, m ?: (state as? TaskState.Running)?.message) },
                    cancelled = { !current.isActive },
                )
                val result = if (htmlRenderer != null) htmlRenderer(ctx) else withContext(Dispatchers.IO) { runner.run(tool, files.toList(), options, ctx) }
                state = TaskState.Done(result)
                val title = files.firstOrNull()?.displayName ?: result.outputs.firstOrNull()?.name ?: tool.id
                c.history.add(tool.id, title, true, files.map { it.displayName }, result.outputs, result.summary, System.currentTimeMillis() - startedAt)
                if (c.settings.current().autoSaveToDownloads) result.outputs.forEach { runCatching { c.workspace.saveToDownloads(it) } }
                c.track("tool_run", mapOf("tool" to tool.id, "ok" to true, "files" to files.size, "ms" to System.currentTimeMillis() - startedAt,
                    "bytes_in" to files.sumOf { it.size }, "bytes_out" to result.outputs.sumOf { it.length() }))
            } catch (e: Throwable) {
                val msg = humanError(e)
                state = if (e is CancellationException) TaskState.Idle else TaskState.Failed(msg)
                if (e is EngineException && e.code == EngineError.PASSWORD_REQUIRED) files.firstOrNull()?.let { passwordFor = it }
                if (e !is CancellationException && e !is ToolInputException) {
                    c.history.add(tool.id, files.firstOrNull()?.displayName ?: tool.id, false, files.map { it.displayName }, emptyList(), msg, System.currentTimeMillis() - startedAt)
                    c.track("tool_run", mapOf("tool" to tool.id, "ok" to false, "error" to ((e as? EngineException)?.code?.name ?: e.javaClass.simpleName)))
                }
            }
        }
    }

    fun cancel() { job?.cancel(); state = TaskState.Idle }

    fun saveAll(onDone: (String) -> Unit) {
        val r = (state as? TaskState.Done)?.result ?: return
        viewModelScope.launch {
            val msg = try { val paths = r.outputs.map { c.workspace.saveToDownloads(it) }; "Enregistré dans ${paths.first().substringBeforeLast('/')}" }
            catch (e: Exception) { "Enregistrement impossible : ${e.message}" }
            onDone(msg)
        }
    }

    fun outputsAsInputs(): List<PickedFile> = (state as? TaskState.Done)?.result?.outputs?.map {
        PickedFile(it, it.name, it.length(), c.workspace.mimeOf(it))
    } ?: emptyList()

    fun cleanup() { files.map { it.file.parentFile }.distinct().filter { it?.parentFile == c.workspace.workRoot }.forEach { it?.deleteRecursively() } }

    override fun onCleared() { super.onCleared(); runCatching { cleanup() } }

    @Suppress("unused") private fun keep(f: File) = f
}
