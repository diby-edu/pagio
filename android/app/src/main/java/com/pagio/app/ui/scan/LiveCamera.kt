package com.pagio.app.ui.scan

import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.pagio.engine.scan.Corner
import com.pagio.engine.scan.DocScan
import com.pagio.engine.scan.Quad
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Image de l'appareil photo réduite et remise à l'endroit, prête pour la détection des bords. */
internal class Frame(val pixels: IntArray, val width: Int, val height: Int)

/**
 * Réduit une image RGBA de l'appareil photo à environ 320 pixels de côté et la tourne de [rotation] degrés
 * (0, 90, 180, 270) pour qu'elle soit dans le même sens que ce que voit l'utilisateur.
 */
internal fun readFrame(image: ImageProxy): Frame {
    val plane = image.planes[0]
    val buffer = plane.buffer; val rowStride = plane.rowStride; val pixelStride = plane.pixelStride
    val step = max(1, max(image.width, image.height) / 320)
    val cw = image.width / step; val ch = image.height / step
    val rotation = image.imageInfo.rotationDegrees
    val turned = rotation % 180 != 0
    val ow = if (turned) ch else cw; val oh = if (turned) cw else ch
    val out = IntArray(ow * oh)
    for (y in 0 until ch) for (x in 0 until cw) {
        val o = y * step * rowStride + x * step * pixelStride
        val r = buffer.get(o).toInt() and 0xFF; val g = buffer.get(o + 1).toInt() and 0xFF; val b = buffer.get(o + 2).toInt() and 0xFF
        val dx: Int; val dy: Int
        when (rotation) {
            90 -> { dx = ch - 1 - y; dy = x }
            180 -> { dx = cw - 1 - x; dy = ch - 1 - y }
            270 -> { dx = y; dy = cw - 1 - x }
            else -> { dx = x; dy = y }
        }
        out[dy * ow + dx] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }
    return Frame(out, ow, oh)
}

private fun distance(a: Quad, b: Quad): Float {
    var d = 0f
    for (i in 0 until 4) d = max(d, max(abs(a.corners[i].x - b.corners[i].x), abs(a.corners[i].y - b.corners[i].y)))
    return d
}

private fun blend(a: Quad, b: Quad): Quad {
    fun mix(p: Corner, q: Corner) = Corner((p.x + q.x) / 2f, (p.y + q.y) / 2f)
    return Quad(mix(a.tl, b.tl), mix(a.tr, b.tr), mix(a.br, b.br), mix(a.bl, b.bl))
}

/**
 * Appareil photo en direct : l'image défile, le cadre suit la feuille, et la photo est prise à la demande
 * ([shutter] augmente à chaque appui sur le déclencheur) ou toute seule quand le cadre est stable ([auto]).
 */
@Composable
fun LiveCamera(
    workDir: File, auto: Boolean, shutter: Int, modifier: Modifier = Modifier,
    onDetected: (Boolean) -> Unit, onPhoto: (File) -> Unit, onFailure: () -> Unit,
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val accent = MaterialTheme.colorScheme.primary
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FIT_CENTER; implementationMode = PreviewView.ImplementationMode.COMPATIBLE } }
    val capture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build() }
    var quad by remember { mutableStateOf<Quad?>(null) }
    var ratio by remember { mutableFloatStateOf(3f / 4f) }
    var ready by remember { mutableStateOf(false) }
    val autoNow by rememberUpdatedState(auto)
    val photo by rememberUpdatedState(onPhoto)
    val failure by rememberUpdatedState(onFailure)
    val detected by rememberUpdatedState(onDetected)
    // État du suivi, modifié uniquement sur le fil principal.
    val track = remember { object { var steady = 0; var misses = 0; var taking = false } }

    fun take() {
        if (track.taking || !ready) return
        track.taking = true
        val file = File(workDir, "photo_${System.currentTimeMillis()}.jpg")
        capture.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(result: ImageCapture.OutputFileResults) { track.taking = false; photo(file) }
                override fun onError(e: ImageCaptureException) { track.taking = false; failure() }
            })
    }

    LaunchedEffect(shutter) { if (shutter > 0) take() }

    DisposableEffect(owner) {
        val executor = Executors.newSingleThreadExecutor()
        val main = ContextCompat.getMainExecutor(context)
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        future.addListener({
            runCatching {
                val p = future.get(); provider = p
                // Même format 4:3 pour l'image affichée, l'image analysée et la photo : le cadre tombe au bon endroit.
                val ratio43 = AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
                val preview = Preview.Builder().setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(ratio43).build()).build()
                preview.setSurfaceProvider(previewView.surfaceProvider)
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder().setAspectRatioStrategy(ratio43)
                            .setResolutionStrategy(ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)).build(),
                    )
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888).build()
                analysis.setAnalyzer(executor) { image ->
                    val result = runCatching { val f = readFrame(image); Triple(DocScan.detect(f.pixels, f.width, f.height), f.width, f.height) }.getOrNull()
                    image.close()
                    if (result != null) main.execute {
                        val (found, fw, fh) = result
                        ratio = fw.toFloat() / fh
                        val previous = quad
                        if (found == null) {
                            // Quelques images sans détection ne font pas disparaître le cadre : il clignoterait.
                            if (++track.misses > 3) { quad = null; track.steady = 0 }
                        } else {
                            track.misses = 0
                            if (previous != null && distance(previous, found) < 0.05f) { quad = blend(previous, found); track.steady++ }
                            else { quad = found; track.steady = 0 }
                        }
                        detected(quad != null)
                        // Cadre immobile depuis une dizaine d'images (environ une seconde) : la photo part toute seule.
                        if (autoNow && track.steady >= 10 && !track.taking) { track.steady = 0; take() }
                    }
                }
                p.unbindAll()
                p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, capture)
                ready = true
            }.onFailure { failure() }
        }, main)
        onDispose { runCatching { provider?.unbindAll() }; executor.shutdown() }
    }

    Box(modifier) {
        AndroidView({ previewView }, Modifier.fillMaxSize())
        Canvas(Modifier.fillMaxSize()) {
            val q = quad ?: return@Canvas
            // L'image de l'appareil photo est affichée entière et centrée : même calcul pour placer le cadre.
            val scale = min(size.width / ratio, size.height)
            val shownW = scale * ratio; val shownH = scale
            val ox = (size.width - shownW) / 2f; val oy = (size.height - shownH) / 2f
            val pts = q.corners.map { Offset(ox + it.x * shownW, oy + it.y * shownH) }
            val path = Path().apply { moveTo(pts[0].x, pts[0].y); for (i in 1..3) lineTo(pts[i].x, pts[i].y); close() }
            drawPath(path, accent.copy(alpha = 0.22f))
            drawPath(path, accent, style = Stroke(width = 3.dp.toPx()))
            pts.forEach { drawCircle(Color.White, 7.dp.toPx(), it); drawCircle(accent, 5.dp.toPx(), it) }
        }
    }
}
