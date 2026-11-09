package com.pagio.app.ui.editor

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.pagio.app.R
import java.io.File
import java.io.FileOutputStream

/** Signatures enregistrées (PNG transparents) + création par dessin ou saisie. */
@Composable
fun SignatureDialog(dir: File, onPicked: (File) -> Unit, onDismiss: () -> Unit) {
    val saved = remember { mutableStateListOf<File>().apply { addAll(dir.listFiles { f -> f.extension == "png" }?.sortedByDescending { it.lastModified() } ?: emptyList()) } }
    var mode by remember { mutableStateOf(if (saved.isEmpty()) 1 else 0) } // 0 = enregistrées, 1 = dessiner, 2 = saisir
    val strokes = remember { mutableStateListOf<List<Offset>>() }
    var current by remember { mutableStateOf<List<Offset>>(emptyList()) }
    var canvasSize by remember { mutableStateOf(IntSize(1, 1)) }
    var ink by remember { mutableStateOf(Color(0xFF1E3A8A)) }
    var typed by remember { mutableStateOf("") }

    fun saveBitmap(bmp: Bitmap): File {
        val f = File(dir, "signature_${System.currentTimeMillis()}.png")
        FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return f
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.signature)) },
        text = {
            Column {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (saved.isNotEmpty()) FilterChip(mode == 0, { mode = 0 }, { Text(stringResource(R.string.sig_saved)) })
                    FilterChip(mode == 1, { mode = 1 }, { Text(stringResource(R.string.sig_draw)) })
                    FilterChip(mode == 2, { mode = 2 }, { Text(stringResource(R.string.sig_type)) })
                }
                Spacer(Modifier.height(12.dp))
                when (mode) {
                    0 -> LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(saved, key = { it.absolutePath }) { f ->
                            Box(Modifier.size(140.dp, 80.dp).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)).background(Color.White, RoundedCornerShape(8.dp)).clickable { onPicked(f) }) {
                                android.graphics.BitmapFactory.decodeFile(f.absolutePath)?.let { Image(it.asImageBitmap(), null, Modifier.padding(6.dp)) }
                                IconButton(onClick = { f.delete(); saved.remove(f) }, modifier = Modifier.size(28.dp)) { Icon(Icons.Outlined.Delete, stringResource(R.string.delete)) }
                            }
                        }
                    }
                    1 -> Column {
                        Canvas(Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(10.dp)).background(Color.White)
                            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                            .onSizeChanged { canvasSize = it }
                            .pointerInput(Unit) {
                                detectDragGestures(
                                    onDragStart = { current = listOf(it) },
                                    onDrag = { change, _ -> current = current + change.position },
                                    onDragEnd = { strokes.add(current); current = emptyList() },
                                )
                            }) {
                            (strokes + listOf(current)).forEach { s ->
                                if (s.size > 1) {
                                    val p = Path().apply { moveTo(s[0].x, s[0].y); s.drop(1).forEach { lineTo(it.x, it.y) } }
                                    drawPath(p, ink, style = Stroke(width = 5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                                }
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                            listOf(Color(0xFF1E3A8A), Color(0xFF111111), Color(0xFFB91C1C)).forEach { col ->
                                Box(Modifier.size(28.dp).clip(CircleShape).background(col).border(if (ink == col) 3.dp else 0.dp, MaterialTheme.colorScheme.primary, CircleShape).clickable { ink = col })
                            }
                            Spacer(Modifier.width(8.dp))
                            TextButton(onClick = { strokes.clear() }) { Text(stringResource(R.string.clear)) }
                        }
                        Text(stringResource(R.string.sig_draw_hint), style = MaterialTheme.typography.bodySmall)
                    }
                    else -> OutlinedTextField(typed, { typed = it }, label = { Text(stringResource(R.string.sig_your_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = {
            if (mode != 0) TextButton(onClick = {
                if (mode == 1 && strokes.isNotEmpty()) {
                    val all = strokes.flatten()
                    val minX = all.minOf { it.x } - 8; val minY = all.minOf { it.y } - 8
                    val maxX = all.maxOf { it.x } + 8; val maxY = all.maxOf { it.y } + 8
                    val bmp = Bitmap.createBitmap((maxX - minX).toInt().coerceAtLeast(10), (maxY - minY).toInt().coerceAtLeast(10), Bitmap.Config.ARGB_8888)
                    val c = android.graphics.Canvas(bmp)
                    val paint = Paint().apply { color = ink.toArgb(); strokeWidth = 5f; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; isAntiAlias = true }
                    strokes.forEach { s -> for (i in 1 until s.size) c.drawLine(s[i - 1].x - minX, s[i - 1].y - minY, s[i].x - minX, s[i].y - minY, paint) }
                    onPicked(saveBitmap(bmp))
                } else if (mode == 2 && typed.isNotBlank()) {
                    val paint = Paint().apply { color = ink.toArgb(); textSize = 96f; isAntiAlias = true; typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD_ITALIC) }
                    val w = paint.measureText(typed).toInt() + 40
                    val bmp = Bitmap.createBitmap(w, 140, Bitmap.Config.ARGB_8888)
                    android.graphics.Canvas(bmp).drawText(typed, 20f, 100f, paint)
                    onPicked(saveBitmap(bmp))
                }
            }) { Text(stringResource(R.string.use_signature)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
    @Suppress("UNUSED_EXPRESSION") canvasSize
}
