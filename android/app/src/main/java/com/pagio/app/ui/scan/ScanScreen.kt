package com.pagio.app.ui.scan

import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.RotateRight
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.pagio.app.R
import com.pagio.app.container
import com.pagio.app.ui.components.ChoiceChips
import com.pagio.app.ui.components.ErrorCard
import com.pagio.engine.ImagePdfOptions
import com.pagio.engine.PdfCreate
import com.pagio.engine.scan.Corner
import com.pagio.engine.scan.Quad
import com.pagio.engine.scan.ScanFilter
import com.pagio.engine.scan.ScanImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.roundToInt

private enum class Step { CROP, PREVIEW }

/**
 * Scanner de Pagio, indépendant des services Google : photo, détection des bords, coins ajustables au doigt,
 * redressement, filtres, plusieurs pages, puis PDF. Sert de relais quand le scanner de Google est indisponible.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanScreen(onBack: () -> Unit, onDone: (File) -> Unit) {
    val context = LocalContext.current
    val c = context.container
    val scope = rememberCoroutineScope()
    // Chemins conservés si Android ferme l'application pendant que l'appareil photo est ouvert (téléphones peu dotés).
    val workPath = rememberSaveable { c.workspace.newTaskDir().absolutePath }
    val workDir = remember(workPath) { File(workPath).apply { mkdirs() } }
    var pendingPath by rememberSaveable { mutableStateOf<String?>(null) }
    var asked by rememberSaveable { mutableStateOf(false) }

    val pages = remember { mutableStateListOf<File>() }
    var photo by remember { mutableStateOf<File?>(null) }
    var preview by remember { mutableStateOf<Bitmap?>(null) }
    var detected by remember { mutableStateOf<Quad?>(null) }
    var quad by remember { mutableStateOf(Quad.FULL) }
    var step by remember { mutableStateOf(Step.CROP) }
    var filter by remember { mutableStateOf(ScanFilter.DOCUMENT) }
    var rotation by remember { mutableIntStateOf(0) }
    var rendered by remember { mutableStateOf<Bitmap?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    fun load(f: File) {
        scope.launch {
            busy = true; problem = null
            val r = withContext(Dispatchers.Default) {
                runCatching { val b = PdfCreate.loadBitmap(f, 1000) ?: throw IllegalStateException("illisible"); b to ScanImage.detect(b) }
            }
            busy = false
            r.onSuccess { (b, q) -> photo = f; preview = b; detected = q; quad = q ?: Quad.FULL; step = Step.CROP; rotation = 0; rendered = null }
                .onFailure { problem = context.getString(R.string.scan_unreadable) }
        }
    }

    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = pendingPath?.let { File(it) }
        if (ok && f != null && f.length() > 0) load(f) else if (photo == null && pages.isEmpty()) onBack()
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { runCatching { c.workspace.import(uri, workDir) }.onSuccess { load(it.file) }.onFailure { problem = context.getString(R.string.scan_unreadable) } }
    }
    fun takePhoto() {
        val f = File(workDir, "photo_${System.currentTimeMillis()}.jpg")
        pendingPath = f.absolutePath
        runCatching { camera.launch(c.workspace.uriFor(f)) }.onFailure { problem = context.getString(R.string.scan_no_camera) }
    }
    fun pickImage() = gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

    LaunchedEffect(Unit) { if (!asked) { asked = true; takePhoto() } }

    // Aperçu du résultat, recalculé à chaque changement de filtre ou de rotation (sur l'image réduite : rapide).
    LaunchedEffect(step, filter, rotation, quad, preview) {
        val src = preview
        if (step == Step.PREVIEW && src != null) {
            rendered = withContext(Dispatchers.Default) { runCatching { ScanImage.render(src, quad, filter, rotation, 1400) }.getOrNull() }
        }
    }

    /** Traite la photo en cours en pleine définition et l'ajoute aux pages. */
    suspend fun commit(): Boolean {
        val f = photo ?: return true
        busy = true; problem = null
        val out = File(workDir, "page_${pages.size + 1}_${System.currentTimeMillis()}.jpg")
        val r = withContext(Dispatchers.Default) { runCatching { ScanImage.process(f, quad, filter, rotation, out) } }
        busy = false
        if (r.isFailure) { problem = context.getString(R.string.scan_failed); return false }
        pages += out; photo = null; preview = null; rendered = null
        return true
    }

    fun addPage() { scope.launch { if (commit()) takePhoto() } }

    fun finish() {
        scope.launch {
            if (!commit() || pages.isEmpty()) return@launch
            busy = true
            val started = System.currentTimeMillis()
            val target = File(c.workspace.newOutputDir(), "scan_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(Date()) + ".pdf")
            val r = withContext(Dispatchers.IO) { runCatching { PdfCreate.imagesToPdf(pages.toList(), ImagePdfOptions(), target) } }
            if (r.isFailure) { busy = false; problem = context.getString(R.string.scan_failed); return@launch }
            c.history.add("scan", target.name, true, emptyList(), listOf(target), "${pages.size} page(s) numérisée(s)", System.currentTimeMillis() - started)
            c.track("scan", mapOf("pages" to pages.size, "engine" to "pagio", "edges_found" to (detected != null)))
            busy = false
            onDone(target)
        }
    }

    BackHandler(enabled = step == Step.PREVIEW && photo != null) { step = Step.CROP }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (pages.isEmpty()) R.string.scan_title else R.string.scan_title_pages, pages.size + if (photo != null) 1 else 0)) },
                navigationIcon = {
                    IconButton(onClick = { if (step == Step.PREVIEW && photo != null) step = Step.CROP else onBack() }) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back))
                    }
                },
                actions = {
                    IconButton(onClick = ::pickImage, enabled = !busy) { Icon(Icons.Outlined.PhotoLibrary, stringResource(R.string.scan_gallery)) }
                    IconButton(onClick = ::takePhoto, enabled = !busy) { Icon(Icons.Outlined.AddAPhoto, stringResource(R.string.scan_retake)) }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().navigationBarsPadding()) {
            problem?.let { ErrorCard(it, Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
            val bmp = preview
            Box(Modifier.weight(1f).fillMaxWidth().background(Color(0xFF15151C)), contentAlignment = Alignment.Center) {
                when {
                    bmp != null && step == Step.CROP -> CropEditor(bmp, quad) { quad = it }
                    bmp != null && step == Step.PREVIEW -> rendered?.let {
                        Image(it.asImageBitmap(), null, Modifier.fillMaxSize().padding(16.dp), contentScale = ContentScale.Fit)
                    }
                    !busy -> Text(
                        stringResource(if (pages.isEmpty()) R.string.scan_empty else R.string.scan_pages_ready, pages.size),
                        color = Color.White, textAlign = TextAlign.Center, modifier = Modifier.padding(32.dp),
                    )
                }
                if (busy || (step == Step.PREVIEW && bmp != null && rendered == null)) CircularProgressIndicator()
            }
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (bmp != null && step == Step.CROP) {
                    Text(
                        stringResource(if (detected != null) R.string.scan_crop_hint else R.string.scan_no_edges),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        detected?.let { d -> TextButton(onClick = { quad = d }) { Text(stringResource(R.string.scan_auto)) } }
                        TextButton(onClick = { quad = Quad.FULL }) { Text(stringResource(R.string.scan_full)) }
                        Spacer(Modifier.weight(1f))
                        Button(onClick = { rendered = null; step = Step.PREVIEW }, enabled = !busy) { Text(stringResource(R.string.scan_next)) }
                    }
                } else if (bmp != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        ChoiceChips(
                            listOf(
                                ScanFilter.DOCUMENT to stringResource(R.string.scan_filter_document), ScanFilter.BLACK_WHITE to stringResource(R.string.scan_filter_bw),
                                ScanFilter.GRAY to stringResource(R.string.scan_filter_gray), ScanFilter.ORIGINAL to stringResource(R.string.scan_filter_original),
                            ),
                            filter, { filter = it }, Modifier.weight(1f),
                        )
                        IconButton(onClick = { rotation = (rotation + 90) % 360 }) { Icon(Icons.AutoMirrored.Outlined.RotateRight, stringResource(R.string.scan_rotate)) }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton(onClick = ::addPage, enabled = !busy, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.scan_add_page)) }
                        Button(onClick = ::finish, enabled = !busy, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.scan_finish)) }
                    }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton(onClick = ::takePhoto, enabled = !busy, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.scan_add_page)) }
                        if (pages.isNotEmpty()) Button(onClick = ::finish, enabled = !busy, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.scan_finish)) }
                    }
                }
            }
        }
    }
}

/** Photo avec le cadre du document : chaque coin se déplace au doigt. */
@Composable
private fun CropEditor(bmp: Bitmap, quad: Quad, onChange: (Quad) -> Unit) {
    val image: ImageBitmap = remember(bmp) { bmp.asImageBitmap() }
    val current by rememberUpdatedState(quad)
    val change by rememberUpdatedState(onChange)
    val accent = MaterialTheme.colorScheme.primary
    Canvas(
        Modifier.fillMaxSize().padding(24.dp).pointerInput(bmp) {
            var grabbed = -1
            detectDragGestures(
                onDragStart = { start ->
                    val (origin, shown) = fit(size.width.toFloat(), size.height.toFloat(), bmp.width, bmp.height)
                    // Le coin le plus proche du doigt, s'il est à portée (zone généreuse : les coins sont petits).
                    var best = -1; var bestD = 56.dp.toPx()
                    current.corners.forEachIndexed { i, k ->
                        val d = hypot(origin.x + k.x * shown.width - start.x, origin.y + k.y * shown.height - start.y)
                        if (d < bestD) { bestD = d; best = i }
                    }
                    grabbed = best
                },
                onDragEnd = { grabbed = -1 }, onDragCancel = { grabbed = -1 },
            ) { change_, drag ->
                if (grabbed < 0) return@detectDragGestures
                change_.consume()
                val (_, shown) = fit(size.width.toFloat(), size.height.toFloat(), bmp.width, bmp.height)
                val k = current.corners[grabbed]
                val moved = current.with(grabbed, Corner((k.x + drag.x / shown.width).coerceIn(0f, 1f), (k.y + drag.y / shown.height).coerceIn(0f, 1f)))
                // Un cadre croisé ou replié ne peut pas être redressé : le déplacement est alors ignoré.
                if (moved.isConvex) change(moved)
            }
        },
    ) {
        val (origin, shown) = fit(size.width, size.height, bmp.width, bmp.height)
        drawImage(image, dstOffset = IntOffset(origin.x.roundToInt(), origin.y.roundToInt()), dstSize = IntSize(shown.width.roundToInt(), shown.height.roundToInt()))
        val pts = quad.corners.map { Offset(origin.x + it.x * shown.width, origin.y + it.y * shown.height) }
        val path = Path().apply { moveTo(pts[0].x, pts[0].y); for (i in 1..3) lineTo(pts[i].x, pts[i].y); close() }
        drawPath(path, accent.copy(alpha = 0.18f))
        drawPath(path, accent, style = Stroke(width = 3.dp.toPx()))
        pts.forEach { drawCircle(Color.White, 11.dp.toPx(), it); drawCircle(accent, 8.dp.toPx(), it) }
    }
}

/** Position et taille d'une image affichée entière et centrée dans une zone. */
private fun fit(areaW: Float, areaH: Float, imgW: Int, imgH: Int): Pair<Offset, Size> {
    val scale = min(areaW / imgW, areaH / imgH)
    val w = imgW * scale; val h = imgH * scale
    return Offset((areaW - w) / 2f, (areaH - h) / 2f) to Size(w, h)
}
