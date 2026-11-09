package com.pagio.app.ui.organize

import android.app.Application
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.RotateLeft
import androidx.compose.material.icons.automirrored.outlined.RotateRight
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.NoteAdd
import androidx.compose.material.icons.outlined.SelectAll
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pagio.app.R
import com.pagio.app.container
import com.pagio.app.tools.Tool
import com.pagio.app.tools.ToolResult
import com.pagio.app.ui.components.EmptyState
import com.pagio.app.ui.components.ErrorCard
import com.pagio.app.ui.components.PasswordDialog
import com.pagio.app.ui.components.PdfThumbnail
import com.pagio.app.ui.components.ProgressDialog
import com.pagio.app.ui.tool.Handoff
import com.pagio.app.ui.tool.ResultPanel
import com.pagio.app.ui.tool.TaskState
import com.pagio.app.ui.tool.ToolViewModel
import com.pagio.engine.PageSpec
import com.pagio.engine.PdfPages
import com.pagio.engine.PdfSecurity
import com.pagio.engine.outputFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyGridState
import java.io.File

private data class PageItem(val key: Long, val source: Int, val rotation: Int = 0, val selected: Boolean = false)

/** Organiser : glisser-déposer des pages, rotation, duplication, suppression, pages blanches. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrganizeScreen(onBack: () -> Unit, onOpen: (File) -> Unit, onContinue: (Tool) -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as Application
    val vm: ToolViewModel = viewModel(key = "organize") { ToolViewModel(app, Tool.ORGANIZE) }
    val pages = remember { mutableStateListOf<PageItem>() }
    var nextKey = remember { longArrayOf(0) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> vm.addUris(listOf(u)) } }
    val file = vm.files.firstOrNull()
    // Rendu : on utilise une copie déverrouillée si le PDF est protégé.
    val renderFile = remember(file?.file, file?.password) { mutableStateListOf<File>() }

    LaunchedEffect(file?.file, file?.password) {
        pages.clear(); renderFile.clear()
        val f = file ?: return@LaunchedEffect
        val n = withContext(Dispatchers.IO) {
            val src = if (f.password != null) PdfSecurity.unlock(f.file, f.password!!, File(context.container.workspace.newTaskDir(), "view.pdf")) else f.file
            renderFile.add(src)
            runCatching { PdfPages.pageCount(src) }.getOrDefault(0)
        }
        repeat(n) { pages.add(PageItem(nextKey[0]++, it)) }
    }

    val gridState = rememberLazyGridState()
    val reorder = rememberReorderableLazyGridState(gridState) { from, to ->
        val fi = pages.indexOfFirst { it.key == from.key }; val ti = pages.indexOfFirst { it.key == to.key }
        if (fi >= 0 && ti >= 0) pages.add(ti, pages.removeAt(fi))
    }
    val selected = pages.filter { it.selected }
    fun update(transform: (PageItem) -> PageItem) { for (i in pages.indices) if (pages[i].selected) pages[i] = transform(pages[i]) }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.t_organize)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) } },
                actions = { if (pages.isNotEmpty()) IconButton(onClick = { val all = pages.all { it.selected }; for (i in pages.indices) pages[i] = pages[i].copy(selected = !all) }) { Icon(Icons.Outlined.SelectAll, stringResource(R.string.select_all)) } })
        },
        bottomBar = {
            if (pages.isNotEmpty() && vm.state !is TaskState.Done) Surface(tonalElevation = 3.dp, modifier = Modifier.navigationBarsPadding()) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                        Action(Icons.AutoMirrored.Outlined.RotateLeft, R.string.rotate_left, selected.isNotEmpty()) { update { it.copy(rotation = (it.rotation + 270) % 360) } }
                        Action(Icons.AutoMirrored.Outlined.RotateRight, R.string.rotate_right, selected.isNotEmpty()) { update { it.copy(rotation = (it.rotation + 90) % 360) } }
                        Action(Icons.Outlined.ContentCopy, R.string.duplicate, selected.isNotEmpty()) {
                            val copy = pages.toList(); pages.clear()
                            copy.forEach { p -> pages.add(p.copy(selected = false)); if (p.selected) pages.add(p.copy(key = nextKey[0]++, selected = false)) }
                        }
                        Action(Icons.Outlined.NoteAdd, R.string.insert_blank, true) {
                            val idx = pages.indexOfLast { it.selected }.let { if (it < 0) pages.size - 1 else it }
                            pages.add(idx + 1, PageItem(nextKey[0]++, -1))
                        }
                        Action(Icons.Outlined.Delete, R.string.delete, selected.isNotEmpty() && selected.size < pages.size) { pages.removeAll { it.selected } }
                    }
                    Button(onClick = {
                        val specs = pages.map { PageSpec(it.source, it.rotation) }
                        vm.run { ctx ->
                            withContext(Dispatchers.IO) {
                                val src = renderFile.firstOrNull() ?: file!!.file
                                val out = outputFile(context.container.workspace.newOutputDir(), file!!.displayName.substringBeforeLast('.') + "_organise", "pdf")
                                PdfPages.organize(src, specs, out, ctx)
                                ToolResult(Tool.ORGANIZE, listOf(out), "${specs.size} page(s) dans le nouvel ordre")
                            }
                        }
                    }, modifier = Modifier.fillMaxWidth().padding(16.dp).height(52.dp)) { Text(stringResource(R.string.apply_changes)) }
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            val st = vm.state
            when {
                st is TaskState.Done -> Column(Modifier.padding(16.dp)) {
                    ResultPanel(st.result, onOpen, { context.startActivity(context.container.workspace.shareIntent(st.result.outputs)) }, { vm.saveAll { } },
                        { f -> runCatching { context.startActivity(context.container.workspace.openWithIntent(f)) } }, { t -> Handoff.files = vm.outputsAsInputs(); onContinue(t) }, { vm.reset() })
                }
                file == null -> EmptyState(Icons.Outlined.UploadFile, stringResource(R.string.pick_file), stringResource(R.string.organize_empty)) {
                    Button(onClick = { picker.launch(arrayOf("application/pdf")) }) { Text(stringResource(R.string.pick_file)) }
                }
                else -> Column {
                    if (st is TaskState.Failed) ErrorCard(st.message, Modifier.padding(16.dp))
                    Text(stringResource(R.string.organize_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                    LazyVerticalGrid(GridCells.Adaptive(104.dp), state = gridState, contentPadding = PaddingValues(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(pages, key = { it.key }) { p ->
                            ReorderableItem(reorder, key = p.key) { dragging ->
                                val idx = pages.indexOf(p)
                                Column(Modifier.longPressDraggableHandle().clickable { if (idx >= 0) pages[idx] = p.copy(selected = !p.selected) },
                                    horizontalAlignment = Alignment.CenterHorizontally) {
                                    Box(Modifier.fillMaxWidth().aspectRatio(0.72f)
                                        .border(if (p.selected || dragging) 3.dp else 1.dp, if (p.selected || dragging) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp))
                                        .padding(4.dp)) {
                                        if (p.source >= 0 && renderFile.isNotEmpty()) PdfThumbnail(renderFile.first(), Modifier.fillMaxSize().rotate(p.rotation.toFloat()), page = p.source, widthPx = 260)
                                        else Box(Modifier.fillMaxSize().border(1.dp, Color.LightGray), contentAlignment = Alignment.Center) { Text(stringResource(R.string.blank_page), style = MaterialTheme.typography.labelMedium) }
                                        Checkbox(p.selected, { if (idx >= 0) pages[idx] = p.copy(selected = it) }, Modifier.align(Alignment.TopEnd))
                                    }
                                    Spacer(Modifier.height(4.dp))
                                    Text("${idx + 1}" + if (p.source >= 0 && p.source != idx) " (p.${p.source + 1})" else "", style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    (vm.state as? TaskState.Running)?.let { ProgressDialog(stringResource(R.string.t_organize), it.progress, it.message) { vm.cancel() } }
    vm.passwordFor?.let { f -> PasswordDialog(f.displayName, vm.passwordError, vm::submitPassword, vm::dismissPassword) }
}

@Composable
private fun Action(icon: androidx.compose.ui.graphics.vector.ImageVector, label: Int, enabled: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(4.dp)) {
        IconButton(onClick = onClick, enabled = enabled) { Icon(icon, stringResource(label)) }
        Text(stringResource(label), style = MaterialTheme.typography.labelMedium, color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline)
    }
}
