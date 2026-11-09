package com.pagio.app.ui.editor

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.Typeface
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.ArrowOutward
import androidx.compose.material.icons.outlined.BorderColor
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CircleNotifications
import androidx.compose.material.icons.outlined.CropSquare
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.FormatStrikethrough
import androidx.compose.material.icons.outlined.FormatUnderlined
import androidx.compose.material.icons.outlined.Gesture
import androidx.compose.material.icons.outlined.HorizontalRule
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.InsertComment
import androidx.compose.material.icons.outlined.NearMe
import androidx.compose.material.icons.outlined.PanoramaFishEye
import androidx.compose.material.icons.outlined.ShortText
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.AutoFixOff
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pagio.app.R
import com.pagio.app.container
import com.pagio.app.tools.Tool
import com.pagio.app.tools.ToolResult
import com.pagio.app.ui.components.EmptyState
import com.pagio.app.ui.components.ErrorCard
import com.pagio.app.ui.components.PasswordDialog
import com.pagio.app.ui.components.ProgressDialog
import com.pagio.app.ui.tool.Handoff
import com.pagio.app.ui.tool.ResultPanel
import com.pagio.app.ui.tool.TaskState
import com.pagio.app.ui.tool.ToolViewModel
import com.pagio.engine.EditElement
import com.pagio.engine.PdfEditor
import com.pagio.engine.PdfRender
import com.pagio.engine.PdfSecurity
import com.pagio.engine.outputFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class EdTool(val icon: ImageVector, val label: Int, val drag: Boolean = false) {
    SELECT(Icons.Outlined.NearMe, R.string.ed_select),
    TEXT(Icons.Outlined.TextFields, R.string.ed_text),
    SIGNATURE(Icons.Outlined.Draw, R.string.ed_signature),
    IMAGE(Icons.Outlined.Image, R.string.ed_image),
    HIGHLIGHT(Icons.Outlined.BorderColor, R.string.ed_highlight, true),
    UNDERLINE(Icons.Outlined.FormatUnderlined, R.string.ed_underline, true),
    STRIKE(Icons.Outlined.FormatStrikethrough, R.string.ed_strike, true),
    INK(Icons.Outlined.Gesture, R.string.ed_ink, true),
    RECT(Icons.Outlined.CropSquare, R.string.ed_rect, true),
    ELLIPSE(Icons.Outlined.PanoramaFishEye, R.string.ed_ellipse, true),
    LINE(Icons.Outlined.HorizontalRule, R.string.ed_line, true),
    ARROW(Icons.Outlined.ArrowOutward, R.string.ed_arrow, true),
    NOTE(Icons.Outlined.InsertComment, R.string.ed_note),
    CHECK(Icons.Outlined.CheckBox, R.string.ed_check),
    DATE(Icons.Outlined.Event, R.string.ed_date),
    FIELD(Icons.Outlined.ShortText, R.string.ed_field, true),
    WHITEOUT(Icons.Outlined.AutoFixOff, R.string.ed_whiteout, true),
}

private val palette = listOf("#111111", "#1E3A8A", "#E5484D", "#14A37F", "#F5A524", "#FFEB3B", "#9B51E0", "#FFFFFF")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(tool: Tool, onBack: () -> Unit, onOpen: (File) -> Unit, onContinue: (Tool) -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as Application
    val c = context.container
    val vm: ToolViewModel = viewModel(key = "editor_${tool.id}") { ToolViewModel(app, tool) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> vm.addUris(listOf(u)) } }
    val file = vm.files.firstOrNull()
    var renderFile by remember { mutableStateOf<File?>(null) }
    var sizes by remember { mutableStateOf<List<Pair<Int, Int>>>(emptyList()) }
    var page by remember { mutableIntStateOf(0) }
    var pageBmp by remember { mutableStateOf<Bitmap?>(null) }
    val elements = remember { mutableStateListOf<EditElement>() }
    var active by remember { mutableStateOf(if (tool == Tool.SIGN) EdTool.SIGNATURE else EdTool.TEXT) }
    var color by remember { mutableStateOf(if (tool == Tool.SIGN) "#1E3A8A" else "#111111") }
    var penSize by remember { mutableStateOf(14f) }
    var selected by remember { mutableStateOf<Int?>(null) }
    var textPrompt by remember { mutableStateOf<Pair<EdTool, Offset>?>(null) }
    var pendingImage by remember { mutableStateOf<File?>(null) }
    var showSignatures by remember { mutableStateOf(false) }
    var dragStart by remember { mutableStateOf<Offset?>(null) }
    var dragNow by remember { mutableStateOf<Offset?>(null) }
    val inkPoints = remember { mutableStateListOf<Offset>() }
    var box by remember { mutableStateOf(IntSize(1, 1)) }
    val imageCache = remember { mutableStateMapOf<String, Bitmap>() }

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { kotlinx.coroutines.MainScope().launch { pendingImage = c.workspace.import(it).file } }
    }

    LaunchedEffect(file?.file, file?.password) {
        val f = file ?: return@LaunchedEffect
        elements.clear(); page = 0
        withContext(Dispatchers.IO) {
            val src = if (f.password != null) runCatching { PdfSecurity.unlock(f.file, f.password!!, File(c.workspace.newTaskDir(), "edit.pdf")) }.getOrNull() else f.file
            renderFile = src
            sizes = src?.let { runCatching { PdfRender.pageSizes(it) }.getOrDefault(emptyList()) } ?: emptyList()
        }
    }
    LaunchedEffect(renderFile, page) {
        val rf = renderFile ?: return@LaunchedEffect
        pageBmp = withContext(Dispatchers.IO) { runCatching { PdfRender.renderPage(rf, page, 1400) }.getOrNull() }
    }
    LaunchedEffect(active) { if (active == EdTool.SIGNATURE) showSignatures = true }

    fun norm(o: Offset) = Offset((o.x / box.width).coerceIn(0f, 1f), (o.y / box.height).coerceIn(0f, 1f))
    val pageW = sizes.getOrNull(page)?.first?.toFloat() ?: 595f
    val pageH = sizes.getOrNull(page)?.second?.toFloat() ?: 842f
    /** Taille en fraction de page pour une taille en points. */
    fun ptW(pt: Float) = pt / pageW
    fun ptH(pt: Float) = pt / pageH

    fun placeAt(p: Offset) {
        when (active) {
            EdTool.TEXT, EdTool.NOTE -> textPrompt = active to p
            EdTool.DATE -> elements += EditElement.Text(page, p.x, p.y, SimpleDateFormat("dd/MM/yyyy", Locale.FRANCE).format(Date()), penSize, color)
            EdTool.CHECK -> elements += EditElement.Check(page, p.x, p.y, penSize, true, fillable = false)
            EdTool.IMAGE, EdTool.SIGNATURE -> pendingImage?.let { f ->
                val bmp = imageCache.getOrPut(f.absolutePath) { BitmapFactory.decodeFile(f.absolutePath) }
                val w = if (active == EdTool.SIGNATURE) 0.32f else 0.4f
                val h = w * pageW / pageH * bmp.height / bmp.width
                elements += EditElement.Image(page, (p.x - w / 2).coerceIn(0f, 1f - w), (p.y - h / 2).coerceIn(0f, 1f - h), w, h, f)
                if (active == EdTool.IMAGE) pendingImage = null
            } ?: run { if (active == EdTool.SIGNATURE) showSignatures = true else imagePicker.launch("image/*") }
            EdTool.SELECT -> selected = elements.indices.lastOrNull { i -> elements[i].page == page && hit(elements[i], p, ptW(16f), ptH(16f)) }
            else -> Unit
        }
    }

    fun finishDrag(a: Offset, b: Offset) {
        val x = minOf(a.x, b.x); val y = minOf(a.y, b.y); val w = kotlin.math.abs(b.x - a.x); val h = kotlin.math.abs(b.y - a.y)
        if (w < 0.01f && h < 0.01f && active != EdTool.INK) return
        when (active) {
            EdTool.HIGHLIGHT -> elements += EditElement.Markup(page, EditElement.MarkupKind.HIGHLIGHT, x, y, w, h.coerceAtLeast(ptH(10f)), if (color == "#111111") "#FFEB3B" else color)
            EdTool.UNDERLINE -> elements += EditElement.Markup(page, EditElement.MarkupKind.UNDERLINE, x, y, w, h.coerceAtLeast(ptH(10f)), color)
            EdTool.STRIKE -> elements += EditElement.Markup(page, EditElement.MarkupKind.STRIKEOUT, x, y, w, h.coerceAtLeast(ptH(10f)), color)
            EdTool.RECT -> elements += EditElement.Shape(page, EditElement.ShapeKind.RECTANGLE, a.x, a.y, b.x, b.y, color, null, penSize / 7f)
            EdTool.ELLIPSE -> elements += EditElement.Shape(page, EditElement.ShapeKind.ELLIPSE, a.x, a.y, b.x, b.y, color, null, penSize / 7f)
            EdTool.LINE -> elements += EditElement.Shape(page, EditElement.ShapeKind.LINE, a.x, a.y, b.x, b.y, color, null, penSize / 7f)
            EdTool.ARROW -> elements += EditElement.Shape(page, EditElement.ShapeKind.ARROW, a.x, a.y, b.x, b.y, color, null, penSize / 7f)
            EdTool.WHITEOUT -> elements += EditElement.Whiteout(page, x, y, w, h)
            EdTool.FIELD -> textPrompt = EdTool.FIELD to Offset(x, y).also { dragNow = Offset(w.coerceAtLeast(ptW(80f)), h.coerceAtLeast(ptH(18f))) }
            else -> Unit
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(tool.title)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    if (selected != null) IconButton(onClick = { selected?.let { if (it in elements.indices) elements.removeAt(it) }; selected = null }) { Icon(Icons.Outlined.Delete, stringResource(R.string.delete)) }
                    IconButton(onClick = { if (elements.isNotEmpty()) elements.removeAt(elements.size - 1); selected = null }, enabled = elements.isNotEmpty()) { Icon(Icons.AutoMirrored.Outlined.Undo, stringResource(R.string.undo)) }
                    TextButton(onClick = {
                        val src = renderFile ?: return@TextButton
                        val list = elements.toList()
                        vm.run { ctx ->
                            withContext(Dispatchers.IO) {
                                val out = outputFile(c.workspace.newOutputDir(), file!!.displayName.substringBeforeLast('.') + if (tool == Tool.SIGN) "_signe" else "_modifie", "pdf")
                                PdfEditor.apply(src, list, out, ctx)
                                ToolResult(tool, listOf(out), "${list.size} modification(s) appliquée(s)")
                            }
                        }
                    }, enabled = elements.isNotEmpty() && vm.state !is TaskState.Running) { Text(stringResource(R.string.save)) }
                })
        },
        bottomBar = {
            if (file != null && vm.state !is TaskState.Done) Surface(tonalElevation = 3.dp, modifier = Modifier.navigationBarsPadding()) {
                Column(Modifier.padding(vertical = 6.dp)) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp)) {
                        items(palette) { hex ->
                            val col = Color(android.graphics.Color.parseColor(hex))
                            Box(Modifier.size(28.dp).clip(CircleShape).background(col).border(if (color == hex) 3.dp else 1.dp, if (color == hex) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, CircleShape).clickable { color = hex })
                        }
                        item { Slider(penSize, { penSize = it }, valueRange = 8f..40f, modifier = Modifier.width(140.dp)) }
                    }
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(4.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp)) {
                        items(EdTool.entries.toList()) { t ->
                            FilterChip(selected = active == t, onClick = { active = t; selected = null; if (t == EdTool.IMAGE && pendingImage == null) imagePicker.launch("image/*") },
                                label = { Text(stringResource(t.label)) }, leadingIcon = { Icon(t.icon, null, Modifier.size(18.dp)) })
                        }
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            val st = vm.state
            when {
                st is TaskState.Done -> Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState())) {
                    ResultPanel(st.result, onOpen, { context.startActivity(c.workspace.shareIntent(st.result.outputs)) }, { vm.saveAll { } },
                        { f -> runCatching { context.startActivity(c.workspace.openWithIntent(f)) } }, { t -> Handoff.files = vm.outputsAsInputs(); onContinue(t) },
                        { vm.reset(); elements.clear() })
                }
                file == null -> EmptyState(Icons.Outlined.UploadFile, stringResource(R.string.pick_file), stringResource(if (tool == Tool.SIGN) R.string.sign_empty else R.string.edit_empty)) {
                    Button(onClick = { picker.launch(arrayOf("application/pdf")) }) { Text(stringResource(R.string.pick_file)) }
                }
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    if (st is TaskState.Failed) ErrorCard(st.message, Modifier.padding(12.dp))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { if (page > 0) { page--; selected = null } }, enabled = page > 0) { Icon(Icons.Outlined.ChevronLeft, stringResource(R.string.previous)) }
                        Text(stringResource(R.string.page_of, page + 1, sizes.size.coerceAtLeast(1)), modifier = Modifier.weight(1f), style = MaterialTheme.typography.labelLarge,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        IconButton(onClick = { if (page < sizes.size - 1) { page++; selected = null } }, enabled = page < sizes.size - 1) { Icon(Icons.Outlined.ChevronRight, stringResource(R.string.next)) }
                    }
                    Text(stringResource(hintFor(active, pendingImage != null)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp))
                    Box(Modifier.padding(12.dp).fillMaxWidth().aspectRatio(pageW / pageH).background(Color.White)
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        pageBmp?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize()) } ?: CircularProgressIndicator(Modifier.align(Alignment.Center))
                        Canvas(Modifier.fillMaxSize()
                            .pointerInput(active, page, pendingImage) {
                                box = IntSize(size.width, size.height)
                                detectTapGestures { placeAt(norm(it)) }
                            }
                            .pointerInput(active, page, selected) {
                                box = IntSize(size.width, size.height)
                                detectDragGestures(
                                    onDragStart = { o ->
                                        val n = norm(o)
                                        if (active == EdTool.SELECT) selected = elements.indices.lastOrNull { i -> elements[i].page == page && hit(elements[i], n, ptW(16f), ptH(16f)) }
                                        dragStart = n; dragNow = n; inkPoints.clear(); inkPoints.add(n)
                                    },
                                    onDrag = { change, amount ->
                                        val n = norm(change.position)
                                        if (active == EdTool.SELECT) {
                                            selected?.let { i -> if (i in elements.indices) elements[i] = moved(elements[i], amount.x / box.width, amount.y / box.height) }
                                        } else { dragNow = n; if (active == EdTool.INK) inkPoints.add(n) }
                                    },
                                    onDragEnd = {
                                        val a = dragStart; val b = dragNow
                                        if (active == EdTool.INK && inkPoints.size > 1) elements += EditElement.Ink(page, listOf(inkPoints.map { it.x to it.y }), color, penSize / 6f)
                                        else if (a != null && b != null && active.drag) finishDrag(a, b)
                                        if (active != EdTool.FIELD) { dragStart = null; dragNow = null }
                                        inkPoints.clear()
                                    },
                                )
                            }) {
                            val scale = this.size.width / pageW
                            elements.forEachIndexed { i, e -> if (e.page == page) drawElement(e, scale, i == selected, imageCache) }
                            val a = dragStart; val b = dragNow
                            if (active == EdTool.INK && inkPoints.size > 1) {
                                val p = Path().apply { moveTo(inkPoints[0].x * this@Canvas.size.width, inkPoints[0].y * this@Canvas.size.height); inkPoints.drop(1).forEach { lineTo(it.x * this@Canvas.size.width, it.y * this@Canvas.size.height) } }
                                drawPath(p, hexColor(color), style = Stroke(penSize / 6f * scale, cap = StrokeCap.Round))
                            } else if (a != null && b != null && active.drag && active != EdTool.SELECT && textPrompt == null) {
                                drawRect(hexColor(color).copy(alpha = 0.25f), Offset(minOf(a.x, b.x) * this.size.width, minOf(a.y, b.y) * this.size.height),
                                    Size(kotlin.math.abs(b.x - a.x) * this.size.width, kotlin.math.abs(b.y - a.y) * this.size.height))
                            }
                        }
                    }
                }
            }
        }
    }

    textPrompt?.let { (kind, p) ->
        var value by remember(kind, p) { mutableStateOf(if (kind == EdTool.FIELD) "champ_${elements.size + 1}" else "") }
        AlertDialog(onDismissRequest = { textPrompt = null; dragStart = null; dragNow = null },
            title = { Text(stringResource(when (kind) { EdTool.NOTE -> R.string.ed_note; EdTool.FIELD -> R.string.field_name; else -> R.string.ed_text })) },
            text = { OutlinedTextField(value, { value = it }, minLines = if (kind == EdTool.FIELD) 1 else 2, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = {
                if (value.isNotBlank()) when (kind) {
                    EdTool.NOTE -> elements += EditElement.Note(page, p.x, p.y, value, c.account.value?.name?.ifBlank { null } ?: "Pagio")
                    EdTool.FIELD -> { val wh = dragNow ?: Offset(0.3f, 0.03f); elements += EditElement.Field(page, p.x, p.y, wh.x, wh.y, value) }
                    else -> elements += EditElement.Text(page, p.x, p.y, value, penSize, color)
                }
                textPrompt = null; dragStart = null; dragNow = null
            }) { Text(stringResource(R.string.add)) } },
            dismissButton = { TextButton(onClick = { textPrompt = null; dragStart = null; dragNow = null }) { Text(stringResource(R.string.cancel)) } })
    }
    if (showSignatures) SignatureDialog(c.workspace.signaturesDir, onPicked = { f -> pendingImage = f; showSignatures = false; active = EdTool.SIGNATURE }, onDismiss = { showSignatures = false })
    (vm.state as? TaskState.Running)?.let { ProgressDialog(stringResource(tool.title), it.progress, it.message) { vm.cancel() } }
    vm.passwordFor?.let { f -> PasswordDialog(f.displayName, vm.passwordError, vm::submitPassword, vm::dismissPassword) }
    @Suppress("UNUSED_EXPRESSION") IntOffset.Zero
}

private fun hintFor(t: EdTool, hasImage: Boolean): Int = when (t) {
    EdTool.SELECT -> R.string.hint_select
    EdTool.TEXT, EdTool.NOTE, EdTool.DATE, EdTool.CHECK -> R.string.hint_tap
    EdTool.IMAGE, EdTool.SIGNATURE -> if (hasImage) R.string.hint_tap_place else R.string.hint_choose_first
    EdTool.INK -> R.string.hint_draw
    else -> R.string.hint_drag
}

private fun hexColor(hex: String) = Color(android.graphics.Color.parseColor(hex))

private fun hit(e: EditElement, p: Offset, tw: Float, th: Float): Boolean {
    fun inRect(x: Float, y: Float, w: Float, h: Float) = p.x in (x - 0.01f)..(x + w + 0.01f) && p.y in (y - 0.01f)..(y + h + 0.01f)
    return when (e) {
        is EditElement.Text -> inRect(e.x, e.y, tw * e.text.length * e.sizePt / 28f, th * e.sizePt / 14f * 1.3f * (e.text.count { it == '\n' } + 1))
        is EditElement.Image -> inRect(e.x, e.y, e.w, e.h)
        is EditElement.Shape -> inRect(minOf(e.x1, e.x2), minOf(e.y1, e.y2), kotlin.math.abs(e.x2 - e.x1), kotlin.math.abs(e.y2 - e.y1))
        is EditElement.Markup -> inRect(e.x, e.y, e.w, e.h)
        is EditElement.Whiteout -> inRect(e.x, e.y, e.w, e.h)
        is EditElement.Field -> inRect(e.x, e.y, e.w, e.h)
        is EditElement.Note -> inRect(e.x, e.y, tw * 1.5f, th * 1.5f)
        is EditElement.Check -> inRect(e.x, e.y, tw, th)
        is EditElement.Ink -> e.strokes.flatten().any { kotlin.math.abs(it.first - p.x) < 0.02f && kotlin.math.abs(it.second - p.y) < 0.02f }
    }
}

private fun moved(e: EditElement, dx: Float, dy: Float): EditElement = when (e) {
    is EditElement.Text -> e.copy(x = e.x + dx, y = e.y + dy)
    is EditElement.Image -> e.copy(x = e.x + dx, y = e.y + dy)
    is EditElement.Shape -> e.copy(x1 = e.x1 + dx, y1 = e.y1 + dy, x2 = e.x2 + dx, y2 = e.y2 + dy)
    is EditElement.Markup -> e.copy(x = e.x + dx, y = e.y + dy)
    is EditElement.Whiteout -> e.copy(x = e.x + dx, y = e.y + dy)
    is EditElement.Field -> e.copy(x = e.x + dx, y = e.y + dy)
    is EditElement.Note -> e.copy(x = e.x + dx, y = e.y + dy)
    is EditElement.Check -> e.copy(x = e.x + dx, y = e.y + dy)
    is EditElement.Ink -> e.copy(strokes = e.strokes.map { s -> s.map { (it.first + dx) to (it.second + dy) } })
}

/** Aperçu à l'écran, cohérent avec le rendu final du moteur PDF. */
private fun DrawScope.drawElement(e: EditElement, scale: Float, selected: Boolean, cache: MutableMap<String, Bitmap>) {
    val W = size.width; val H = size.height
    when (e) {
        is EditElement.Text -> {
            val paint = Paint().apply {
                color = android.graphics.Color.parseColor(e.colorHex); textSize = e.sizePt * scale; isAntiAlias = true
                typeface = Typeface.create(Typeface.SANS_SERIF, (if (e.bold) Typeface.BOLD else 0) or (if (e.italic) Typeface.ITALIC else 0))
            }
            var y = e.y * H + e.sizePt * scale
            e.text.split('\n').forEach { line -> drawContext.canvas.nativeCanvas.drawText(line, e.x * W, y, paint); y += e.sizePt * scale * 1.25f }
        }
        is EditElement.Image -> cache.getOrPut(e.file.absolutePath) { BitmapFactory.decodeFile(e.file.absolutePath) }?.let { bmp ->
            drawImage(bmp.asImageBitmap(), dstOffset = IntOffset((e.x * W).toInt(), (e.y * H).toInt()), dstSize = IntSize((e.w * W).toInt(), (e.h * H).toInt()))
        }
        is EditElement.Shape -> {
            val col = hexColor(e.strokeHex); val st = Stroke(e.widthPt * scale)
            val tl = Offset(minOf(e.x1, e.x2) * W, minOf(e.y1, e.y2) * H); val sz = Size(kotlin.math.abs(e.x2 - e.x1) * W, kotlin.math.abs(e.y2 - e.y1) * H)
            when (e.kind) {
                EditElement.ShapeKind.RECTANGLE -> drawRect(col, tl, sz, style = st)
                EditElement.ShapeKind.ELLIPSE -> drawOval(col, tl, sz, style = st)
                else -> {
                    val a = Offset(e.x1 * W, e.y1 * H); val b = Offset(e.x2 * W, e.y2 * H)
                    drawLine(col, a, b, e.widthPt * scale, StrokeCap.Round)
                    if (e.kind == EditElement.ShapeKind.ARROW) {
                        val ang = kotlin.math.atan2(b.y - a.y, b.x - a.x); val len = (6f + e.widthPt * 3) * scale
                        for (d in listOf(Math.PI * 0.85, -Math.PI * 0.85)) drawLine(col, b, Offset(b.x + len * kotlin.math.cos(ang + d).toFloat(), b.y + len * kotlin.math.sin(ang + d).toFloat()), e.widthPt * scale)
                    }
                }
            }
        }
        is EditElement.Markup -> {
            val col = hexColor(e.colorHex)
            when (e.kind) {
                EditElement.MarkupKind.HIGHLIGHT -> drawRect(col.copy(alpha = 0.38f), Offset(e.x * W, e.y * H), Size(e.w * W, e.h * H))
                EditElement.MarkupKind.UNDERLINE -> drawLine(col, Offset(e.x * W, (e.y + e.h) * H), Offset((e.x + e.w) * W, (e.y + e.h) * H), maxOf(2f, e.h * H * 0.08f))
                EditElement.MarkupKind.STRIKEOUT -> drawLine(col, Offset(e.x * W, (e.y + e.h / 2) * H), Offset((e.x + e.w) * W, (e.y + e.h / 2) * H), maxOf(2f, e.h * H * 0.08f))
            }
        }
        is EditElement.Ink -> e.strokes.forEach { s ->
            if (s.size > 1) drawPath(Path().apply { moveTo(s[0].first * W, s[0].second * H); s.drop(1).forEach { lineTo(it.first * W, it.second * H) } },
                hexColor(e.colorHex), style = Stroke(e.widthPt * scale, cap = StrokeCap.Round))
        }
        is EditElement.Note -> drawRect(Color(0xFFFFD43B), Offset(e.x * W, e.y * H), Size(22 * scale, 22 * scale))
        is EditElement.Check -> {
            drawRect(Color.Black, Offset(e.x * W, e.y * H), Size(e.sizePt * scale, e.sizePt * scale), style = Stroke(1.5f))
            if (e.checked) drawLine(Color(0xFF1A7333), Offset((e.x * W) + e.sizePt * scale * 0.2f, e.y * H + e.sizePt * scale * 0.5f), Offset(e.x * W + e.sizePt * scale * 0.8f, e.y * H + e.sizePt * scale * 0.2f), 3f)
        }
        is EditElement.Field -> drawRect(Color(0xFF5B4BDB), Offset(e.x * W, e.y * H), Size(e.w * W, e.h * H), style = Stroke(2f))
        is EditElement.Whiteout -> drawRect(hexColor(e.colorHex), Offset(e.x * W, e.y * H), Size(e.w * W, e.h * H))
    }
    if (selected) {
        val r = when (e) {
            is EditElement.Image -> Triple(e.x, e.y, Size(e.w * W, e.h * H))
            is EditElement.Text -> Triple(e.x, e.y, Size(e.text.length * e.sizePt * scale * 0.55f, e.sizePt * scale * 1.3f))
            else -> null
        }
        r?.let { (x, y, s) -> drawRect(Color(0xFF5B4BDB), Offset(x * W - 4, y * H - 4), Size(s.width + 8, s.height + 8), style = Stroke(2f)) }
    }
}

@Suppress("unused") private val keepSpacer: @Composable () -> Unit = { Spacer(Modifier.height(0.dp)) }
@Suppress("unused") private val keepIcon = Icons.Outlined.CircleNotifications
