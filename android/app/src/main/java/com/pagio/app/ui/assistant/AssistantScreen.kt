package com.pagio.app.ui.assistant

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.OfflineBolt
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pagio.ai.AssistantResult
import com.pagio.ai.ChatMessage
import com.pagio.ai.DocumentAssistant
import com.pagio.ai.LanguageDetector
import com.pagio.app.R
import com.pagio.app.container
import com.pagio.app.tools.Tool
import com.pagio.app.tools.ToolRunner
import com.pagio.app.ui.components.EmptyState
import com.pagio.app.ui.components.ErrorCard
import com.pagio.app.ui.components.InfoCard
import com.pagio.app.ui.components.PasswordDialog
import com.pagio.app.ui.tool.ToolViewModel
import com.pagio.app.ui.tool.humanError
import com.pagio.engine.PdfCreate
import com.pagio.engine.TaskContext
import com.pagio.engine.TextPdfOptions
import com.pagio.engine.outputFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class Mode(val label: Int) {
    SUMMARY(R.string.ai_summary), CHAT(R.string.ai_chat), KEYINFO(R.string.ai_keyinfo), INVOICE(R.string.ai_invoice),
    CLASSIFY(R.string.ai_classify), QUESTIONS(R.string.ai_questions), TRANSLATE(R.string.ai_translate), REPHRASE(R.string.ai_rephrase)
}

private val targetLanguages = listOf("fr" to "Français", "en" to "Anglais", "es" to "Espagnol", "de" to "Allemand", "it" to "Italien",
    "pt" to "Portugais", "nl" to "Néerlandais", "ar" to "Arabe", "zh" to "Chinois", "ru" to "Russe", "sw" to "Swahili")

/** Assistant documentaire : OCR automatique, IA hors ligne et IA générative au choix. */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun AssistantScreen(tool: Tool, onBack: () -> Unit, onOpenSettings: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as Application
    val c = context.container
    val vm: ToolViewModel = viewModel(key = "assistant") { ToolViewModel(app, Tool.ASSISTANT) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> vm.addUris(listOf(u)) } }
    val scope = rememberCoroutineScope()
    val file = vm.files.firstOrNull()
    var docText by remember { mutableStateOf<String?>(null) }
    var language by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf<Pair<Float, String>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var assistant by remember { mutableStateOf<DocumentAssistant?>(null) }
    var mode by remember { mutableStateOf(when (tool) { Tool.TRANSLATE -> Mode.TRANSLATE; Tool.INVOICE -> Mode.INVOICE; Tool.CLASSIFY -> Mode.CLASSIFY; else -> Mode.SUMMARY }) }
    var result by remember { mutableStateOf<AssistantResult?>(null) }
    val chat = remember { mutableStateListOf<ChatMessage>() }
    var input by remember { mutableStateOf("") }
    var target by remember { mutableStateOf("en") }
    var detail by remember { mutableStateOf("standard") }
    var tone by remember { mutableStateOf("professionnel") }
    var job by remember { mutableStateOf<Job?>(null) }

    LaunchedEffect(Unit) { assistant = c.assistant() }
    LaunchedEffect(file?.file, file?.password) {
        val f = file ?: return@LaunchedEffect
        if (f.isPdf && f.password == null && withContext(Dispatchers.IO) { com.pagio.engine.PdfSecurity.isEncrypted(f.file) }) return@LaunchedEffect
        docText = null; result = null; chat.clear(); error = null
        loading = 0f to context.getString(R.string.reading_doc)
        try {
            val text = withContext(Dispatchers.IO) { ToolRunner(c).documentText(f, TaskContext({ p, m -> loading = p to (m ?: "") })) }
            docText = text
            language = runCatching { c.languages.detect(text) }.getOrNull()
            if (language == "en") target = "fr"
            if (text.isBlank()) error = context.getString(R.string.no_text_found)
        } catch (e: Throwable) { error = humanError(e) } finally { loading = null }
    }

    fun launchTask(block: suspend (DocumentAssistant, String) -> AssistantResult) {
        val a = assistant ?: return; val t = docText ?: return
        error = null; loading = 0f to context.getString(R.string.ai_working)
        job = scope.launch {
            try { result = block(a, t); c.track("ai_task", mapOf("task" to mode.name, "offline" to result?.offline)); c.reloadAccount() }
            catch (e: Throwable) { if (e !is kotlinx.coroutines.CancellationException) error = humanError(e) }
            finally { loading = null }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(stringResource(tool.title)) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) } })
    }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            if (file == null) {
                EmptyState(Icons.Outlined.UploadFile, stringResource(R.string.pick_file), stringResource(R.string.assistant_empty)) {
                    Button(onClick = { picker.launch(arrayOf("application/pdf", "image/*", "text/plain")) }) { Text(stringResource(R.string.pick_file)) }
                }
                return@Box
            }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).imePadding()) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
                    Column(Modifier.padding(14.dp)) {
                        Text(file.displayName, style = MaterialTheme.typography.titleSmall)
                        docText?.let { Text(stringResource(R.string.doc_stats, it.length, LanguageDetector.displayName(language)), style = MaterialTheme.typography.bodySmall) }
                        Spacer(Modifier.padding(2.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (assistant?.hasGenerative == true) Icons.Outlined.AutoAwesome else Icons.Outlined.OfflineBolt, null, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(if (assistant?.hasGenerative == true) R.string.ai_generative_on else R.string.ai_offline_only), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                            if (assistant?.hasGenerative != true) TextButton(onClick = onOpenSettings) { Text(stringResource(R.string.configure)) }
                        }
                        TextButton(onClick = { picker.launch(arrayOf("application/pdf", "image/*", "text/plain")) }) { Text(stringResource(R.string.change_document)) }
                    }
                }
                loading?.let { (p, m) ->
                    Spacer(Modifier.padding(6.dp))
                    if (p > 0f) LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth()) else LinearProgressIndicator(Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(m, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        if (job?.isActive == true) TextButton(onClick = { job?.cancel(); loading = null }) { Text(stringResource(R.string.cancel)) }
                    }
                }
                error?.let { Spacer(Modifier.padding(6.dp)); ErrorCard(it) }
                if (docText.isNullOrBlank()) return@Column
                Spacer(Modifier.padding(8.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Mode.entries.forEach { m -> FilterChip(mode == m, { mode = m; result = null; error = null }, { Text(stringResource(m.label)) }) }
                }
                Spacer(Modifier.padding(6.dp))
                when (mode) {
                    Mode.SUMMARY -> {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("court" to R.string.sum_short, "standard" to R.string.sum_standard, "détaillé" to R.string.sum_detailed).forEach { (k, l) -> FilterChip(detail == k, { detail = k }, { Text(stringResource(l)) }) }
                        }
                        Button(onClick = { launchTask { a, t -> a.summarize(t, detail) } }, enabled = loading == null) { Text(stringResource(R.string.ai_summary)) }
                    }
                    Mode.CHAT -> {
                        if (assistant?.hasGenerative != true) InfoCard(stringResource(R.string.chat_needs_ai))
                        chat.forEach { m ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = if (m.role == "user") Arrangement.End else Arrangement.Start) {
                                Surface(shape = RoundedCornerShape(16.dp), color = if (m.role == "user") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh,
                                    modifier = Modifier.widthIn(max = 320.dp)) {
                                    SelectionContainer { Text(m.content, Modifier.padding(12.dp), color = if (m.role == "user") MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface) }
                                }
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(input, { input = it }, Modifier.weight(1f), placeholder = { Text(stringResource(R.string.ask_question)) }, maxLines = 4)
                            IconButton(onClick = {
                                val q = input.trim(); if (q.isEmpty()) return@IconButton
                                val history = chat.toList(); chat += ChatMessage("user", q); input = ""
                                val a = assistant ?: return@IconButton; val t = docText ?: return@IconButton
                                loading = 0f to context.getString(R.string.ai_working); error = null
                                job = scope.launch {
                                    try { chat += ChatMessage("assistant", a.chat(t, history, q).text); c.track("ai_task", mapOf("task" to "CHAT")) }
                                    catch (e: Throwable) { if (e !is kotlinx.coroutines.CancellationException) error = humanError(e) } finally { loading = null }
                                }
                            }, enabled = loading == null) { Icon(Icons.AutoMirrored.Outlined.Send, stringResource(R.string.send)) }
                        }
                        listOf(R.string.suggest_q1, R.string.suggest_q2, R.string.suggest_q3).forEach { s ->
                            val text = stringResource(s)
                            TextButton(onClick = { input = text }) { Text(text, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    Mode.KEYINFO -> Button(onClick = { launchTask { a, t -> a.keyInfo(t) } }, enabled = loading == null) { Text(stringResource(R.string.ai_keyinfo)) }
                    Mode.INVOICE -> Button(onClick = { launchTask { a, t -> a.invoice(t) } }, enabled = loading == null) { Text(stringResource(R.string.ai_invoice)) }
                    Mode.CLASSIFY -> Button(onClick = { launchTask { a, t -> a.classify(t) } }, enabled = loading == null) { Text(stringResource(R.string.ai_classify)) }
                    Mode.QUESTIONS -> Button(onClick = { launchTask { a, t -> a.questions(t) } }, enabled = loading == null) { Text(stringResource(R.string.ai_questions)) }
                    Mode.TRANSLATE -> {
                        Text(stringResource(R.string.target_language), style = MaterialTheme.typography.titleSmall)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { targetLanguages.forEach { (code, name) -> FilterChip(target == code, { target = code }, { Text(name) }) } }
                        InfoCard(stringResource(if (assistant?.hasGenerative == true) R.string.translate_generative else R.string.translate_on_device))
                        Button(onClick = {
                            launchTask { a, t ->
                                if (a.hasGenerative) a.translateGenerative(t, targetLanguages.first { it.first == target }.second)
                                else {
                                    val from = language ?: throw com.pagio.ai.AiException(context.getString(R.string.lang_unknown))
                                    val clean = t.replace(Regex("\\[Page \\d+]\\n"), "")
                                    AssistantResult(c.translator.translate(clean.take(30_000), from, target) { p -> loading = p to context.getString(R.string.translating) }, null, true,
                                        context.getString(R.string.translate_on_device_note))
                                }
                            }
                        }, enabled = loading == null) { Text(stringResource(R.string.ai_translate)) }
                    }
                    Mode.REPHRASE -> {
                        OutlinedTextField(input, { input = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.passage)) }, minLines = 3)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("professionnel", "simple et clair", "formel", "amical", "concis").forEach { t -> FilterChip(tone == t, { tone = t }, { Text(t) }) }
                        }
                        Button(onClick = { val passage = input; launchTask { a, _ -> a.rephrase(passage, tone) } }, enabled = loading == null) { Text(stringResource(R.string.ai_rephrase)) }
                    }
                }
                result?.let { r -> ResultCard(context, r, file.displayName.substringBeforeLast('.'), stringResource(mode.label)) }
            }
        }
    }
    vm.passwordFor?.let { f -> PasswordDialog(f.displayName, vm.passwordError, vm::submitPassword, vm::dismissPassword) }
}

@Composable
private fun ResultCard(context: Context, r: AssistantResult, baseName: String, title: String) {
    val c = context.container
    val scope = rememberCoroutineScope()
    Card(Modifier.fillMaxWidth().padding(top = 14.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(r.usedProvider?.let { context.getString(R.string.generated_by, it) } ?: context.getString(R.string.generated_offline),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.padding(4.dp))
            SelectionContainer { Text(r.text, style = MaterialTheme.typography.bodyMedium) }
            r.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp)) }
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(title, r.text))
                }) { Icon(Icons.Outlined.ContentCopy, null); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.copy)) }
                OutlinedButton(onClick = {
                    scope.launch {
                        val f = withContext(Dispatchers.IO) {
                            PdfCreate.textToPdf(r.text, TextPdfOptions(title = "$title — $baseName"), outputFile(c.workspace.newOutputDir(), "${baseName}_${title.lowercase().replace(' ', '_')}", "pdf"))
                        }
                        c.history.add("assistant", "$title — $baseName", true, listOf(baseName), listOf(f), r.text.take(120), 0)
                        context.startActivity(c.workspace.shareIntent(listOf(f)))
                    }
                }) { Icon(Icons.Outlined.PictureAsPdf, null); Spacer(Modifier.width(4.dp)); Text("PDF") }
                OutlinedButton(onClick = {
                    context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, r.text), null))
                }) { Icon(Icons.Outlined.Share, null) }
            }
        }
    }
}
