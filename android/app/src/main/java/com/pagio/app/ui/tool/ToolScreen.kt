package com.pagio.app.ui.tool

import android.app.Application
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pagio.app.R
import com.pagio.app.container
import com.pagio.app.data.humanSize
import com.pagio.app.tools.InputKind
import com.pagio.app.tools.Tool
import com.pagio.app.tools.ToolResult
import com.pagio.app.ui.components.ErrorCard
import com.pagio.app.ui.components.OfflineBadge
import com.pagio.app.ui.components.PasswordDialog
import com.pagio.app.ui.components.PdfThumbnail
import com.pagio.app.ui.components.ProgressDialog
import com.pagio.app.ui.components.ToolIcon
import com.pagio.engine.outputFile
import kotlinx.coroutines.launch
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ToolScreen(tool: Tool, onBack: () -> Unit, onOpen: (File) -> Unit, onContinue: (Tool) -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as Application
    val vm: ToolViewModel = viewModel(key = "tool_${tool.id}") { ToolViewModel(app, tool) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val state = vm.state

    // Garde l'écran allumé pendant un traitement long.
    LocalView.current.keepScreenOn = state is TaskState.Running

    val multiPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { vm.addUris(it) }
    val singlePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? -> uri?.let { vm.addUris(listOf(it)) } }
    val pick = { if (tool.multiple) multiPicker.launch(tool.input.mimes) else singlePicker.launch(tool.input.mimes) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(tool.title)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (state !is TaskState.Done) {
                Surface(tonalElevation = 3.dp, modifier = Modifier.navigationBarsPadding().imePadding()) {
                    Button(
                        onClick = {
                            if (tool == Tool.HTML_TO_PDF) vm.run { ctx ->
                                val src = vm.files.firstOrNull()?.file
                                val name = vm.files.firstOrNull()?.displayName?.substringBeforeLast('.') ?: vm.options.htmlUrl.substringAfter("//").substringBefore('/').ifBlank { "page_web" }
                                val out = outputFile(context.container.workspace.newOutputDir(), name, "pdf")
                                HtmlRenderer.render(context, src, vm.options.htmlUrl.ifBlank { null }, out) { p, m -> ctx.progress(p, m) }
                                ToolResult(tool, listOf(out), "Page convertie en PDF A4")
                            } else vm.run()
                        },
                        enabled = state !is TaskState.Running && !vm.importing,
                        modifier = Modifier.fillMaxWidth().padding(16.dp).height(54.dp),
                    ) {
                        Text(stringResource(R.string.run_tool, stringResource(tool.title)), style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        ) {
            ToolHeader(tool)
            if (state is TaskState.Done) {
                ResultPanel(state.result, onOpen = onOpen,
                    onShare = { context.startActivity(context.container.workspace.shareIntent(state.result.outputs)) },
                    onSave = { vm.saveAll { msg -> scope.launch { snackbar.showSnackbar(msg) } } },
                    onOpenWith = { f -> runCatching { context.startActivity(context.container.workspace.openWithIntent(f)) }
                        .onFailure { scope.launch { snackbar.showSnackbar(context.getString(R.string.no_app_to_open)) } } },
                    onContinue = { t -> Handoff.files = vm.outputsAsInputs(); onContinue(t) },
                    onRestart = { vm.reset() })
                Spacer(Modifier.height(24.dp))
                return@Column
            }
            if (tool.input != InputKind.NONE) {
                FileSection(vm, tool, pick)
            }
            if (state is TaskState.Failed) { Spacer(Modifier.height(12.dp)); ErrorCard(state.message) }
            ToolOptionsUi(tool, vm)
            Spacer(Modifier.height(24.dp))
        }
    }

    if (state is TaskState.Running) ProgressDialog(stringResource(tool.title), state.progress, state.message) { vm.cancel() }
    vm.passwordFor?.let { f -> PasswordDialog(f.displayName, vm.passwordError, vm::submitPassword, vm::dismissPassword) }
}

@Composable
private fun ToolHeader(tool: Tool) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        ToolIcon(tool, 52)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(stringResource(tool.desc), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(4.dp))
            OfflineBadge(offline = true)
        }
    }
}

@Composable
private fun FileSection(vm: ToolViewModel, tool: Tool, pick: () -> Unit) {
    val files = vm.files
    if (files.isEmpty() && !(tool == Tool.HTML_TO_PDF)) {
        Card(onClick = pick, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
            Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Outlined.UploadFile, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(8.dp))
                Text(stringResource(if (tool.multiple) R.string.pick_files else R.string.pick_file), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.pick_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.selected_files, files.size), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        if (tool.multiple || files.isEmpty()) FilledTonalButton(onClick = pick) { Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.add)) }
        else OutlinedButton(onClick = pick) { Text(stringResource(R.string.replace)) }
    }
    if (tool.multiple && files.size > 1) Text(stringResource(R.string.order_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    files.forEachIndexed { i, f ->
        Card(Modifier.fillMaxWidth().padding(top = 8.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                if (f.isPdf && f.password == null) PdfThumbnail(f.file, Modifier.size(44.dp, 56.dp), widthPx = 120)
                else Box(Modifier.size(44.dp, 56.dp), contentAlignment = Alignment.Center) { Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null, tint = MaterialTheme.colorScheme.primary) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(f.displayName, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(f.size.humanSize() + if (f.password != null) " · 🔒" else "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (tool.multiple && files.size > 1) {
                    IconButton(onClick = { vm.move(i, i - 1) }, enabled = i > 0) { Icon(Icons.Outlined.KeyboardArrowUp, stringResource(R.string.move_up)) }
                    IconButton(onClick = { vm.move(i, i + 1) }, enabled = i < files.size - 1) { Icon(Icons.Outlined.KeyboardArrowDown, stringResource(R.string.move_down)) }
                }
                IconButton(onClick = { vm.remove(f) }) { Icon(Icons.Outlined.Close, stringResource(R.string.remove)) }
            }
        }
    }
}

@Composable
fun ResultPanel(
    result: ToolResult, onOpen: (File) -> Unit, onShare: () -> Unit, onSave: () -> Unit, onOpenWith: (File) -> Unit,
    onContinue: (Tool) -> Unit, onRestart: () -> Unit,
) {
    Card(Modifier.fillMaxWidth().padding(top = 8.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.CheckCircle, null, tint = MaterialTheme.colorScheme.tertiary, modifier = Modifier.size(32.dp))
            Spacer(Modifier.width(12.dp))
            Column {
                Text(stringResource(R.string.done_title), style = MaterialTheme.typography.titleMedium)
                Text(result.summary, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    result.report?.let { report ->
        Card(Modifier.fillMaxWidth().padding(top = 12.dp)) {
            SelectionContainer { Text(report, Modifier.padding(14.dp), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Default) }
        }
    }
    if (result.outputs.isNotEmpty()) {
        Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onShare, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.Share, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.share)) }
            FilledTonalButton(onClick = onSave, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.Download, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.save)) }
        }
        result.outputs.forEach { f ->
            Card(onClick = { if (f.extension.equals("pdf", true)) onOpen(f) else onOpenWith(f) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (f.extension.equals("pdf", true)) PdfThumbnail(f, Modifier.size(48.dp, 62.dp), widthPx = 140)
                    else Box(Modifier.size(48.dp, 62.dp), contentAlignment = Alignment.Center) { Text(f.extension.uppercase(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(f.name, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(f.length().humanSize(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = { onOpenWith(f) }) { Icon(Icons.Outlined.OpenInNew, stringResource(R.string.open_with)) }
                }
            }
        }
        val pdfOut = result.outputs.all { it.extension.equals("pdf", true) }
        if (pdfOut) {
            var menu by remember { mutableStateOf(false) }
            Box(Modifier.padding(top = 12.dp)) {
                OutlinedButton(onClick = { menu = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.continue_with)); Spacer(Modifier.width(6.dp)); Icon(Icons.AutoMirrored.Outlined.ArrowForward, null)
                }
                DropdownMenu(menu, { menu = false }) {
                    listOf(Tool.COMPRESS, Tool.MERGE, Tool.EDIT, Tool.SIGN, Tool.PAGE_NUMBERS, Tool.WATERMARK, Tool.PROTECT, Tool.ORGANIZE, Tool.OCR, Tool.ASSISTANT, Tool.PDF_TO_WORD)
                        .filter { it != result.tool }.forEach { t ->
                            DropdownMenuItem(text = { Text(stringResource(t.title)) }, leadingIcon = { Icon(t.icon, null) }, onClick = { menu = false; onContinue(t) })
                        }
                }
            }
        }
    }
    OutlinedButton(onClick = onRestart, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.start_again))
    }
}
