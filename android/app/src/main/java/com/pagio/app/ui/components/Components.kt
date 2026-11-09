package com.pagio.app.ui.components

import android.graphics.Bitmap
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudQueue
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.OfflineBolt
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.pagio.app.R
import com.pagio.app.tools.Tool
import com.pagio.engine.Anchor
import com.pagio.engine.PdfRender
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(top = 20.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        action?.invoke()
    }
}

@Composable
fun ToolIcon(tool: Tool, size: Int = 44) {
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape((size / 3.2f).dp)).background(tool.category.color.copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center,
    ) { Icon(tool.icon, null, tint = tool.category.color, modifier = Modifier.size((size * 0.55f).dp)) }
}

/** Tuile d'outil dans les grilles. */
@Composable
fun ToolTile(tool: Tool, modifier: Modifier = Modifier, favorite: Boolean = false, onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    Card(
        onClick = onClick, modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                ToolIcon(tool)
                Spacer(Modifier.weight(1f))
                if (tool.isNew) Badge(stringResource(R.string.badge_new), MaterialTheme.colorScheme.secondary)
                if (favorite) Text("★", color = Color(0xFFF5A524), modifier = Modifier.padding(start = 4.dp))
            }
            Spacer(Modifier.height(10.dp))
            Text(stringResource(tool.title), style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Text(stringResource(tool.desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun Badge(text: String, color: Color) {
    Surface(shape = CircleShape, color = color.copy(alpha = 0.15f)) {
        Text(text, color = color, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

@Composable
fun OfflineBadge(offline: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(if (offline) Icons.Outlined.OfflineBolt else Icons.Outlined.CloudQueue, null, Modifier.size(16.dp),
            tint = if (offline) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(4.dp))
        Text(stringResource(if (offline) R.string.badge_on_device else R.string.badge_server), style = MaterialTheme.typography.labelMedium,
            color = if (offline) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary)
    }
}

/** Fenêtre de progression avec bouton Annuler (le traitement s'arrête proprement). */
@Composable
fun ProgressDialog(title: String, progress: Float?, message: String?, onCancel: () -> Unit) {
    AlertDialog(
        onDismissRequest = {},
        title = { Text(title) },
        text = {
            Column {
                if (progress == null || progress <= 0f) LinearProgressIndicator(Modifier.fillMaxWidth())
                else LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(12.dp))
                Text(message ?: stringResource(R.string.working), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (progress != null && progress > 0f) Text("${(progress * 100).toInt()} %", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 4.dp))
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
fun PasswordDialog(fileName: String, error: String?, onSubmit: (String) -> Unit, onDismiss: () -> Unit) {
    var value by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Outlined.Lock, null) },
        title = { Text(stringResource(R.string.password_required)) },
        text = {
            Column {
                Text(stringResource(R.string.password_required_msg, fileName))
                Spacer(Modifier.height(12.dp))
                PasswordField(value, { value = it }, stringResource(R.string.password), isError = error != null)
                if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = { onSubmit(value) }, enabled = value.isNotEmpty()) { Text(stringResource(R.string.unlock)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
fun PasswordField(value: String, onChange: (String) -> Unit, label: String, isError: Boolean = false, modifier: Modifier = Modifier) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true, isError = isError,
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        trailingIcon = { IconButton(onClick = { visible = !visible }) { Icon(if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, stringResource(R.string.show_password)) } },
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
fun ErrorCard(message: String, modifier: Modifier = Modifier) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer), modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ErrorOutline, null, tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(10.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onErrorContainer)
        }
    }
}

@Composable
fun InfoCard(text: String, icon: ImageVector? = null, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.primaryContainer) {
    Card(colors = CardDefaults.cardColors(containerColor = color), modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) { Icon(icon, null); Spacer(Modifier.width(10.dp)) }
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** Choix exclusif sous forme de pastilles. */
@Composable
fun <T> ChoiceChips(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            FilterChip(selected = value == selected, onClick = { onSelect(value) }, label = { Text(label) })
        }
    }
}

@Composable
fun SwitchRow(title: String, checked: Boolean, onChange: (Boolean) -> Unit, subtitle: String? = null) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked, onChange)
    }
}

@Composable
fun SliderRow(title: String, value: Float, range: ClosedFloatingPointRange<Float>, display: String, steps: Int = 0, onChange: (Float) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row { Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f)); Text(display, style = MaterialTheme.typography.labelLarge) }
        Slider(value = value, onValueChange = onChange, valueRange = range, steps = steps)
    }
}

/** Grille 3×3 de positions (numéros de page, filigrane). */
@Composable
fun AnchorPicker(selected: Anchor, onSelect: (Anchor) -> Unit) {
    Column(Modifier.width(150.dp).aspectRatio(0.75f).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)).padding(6.dp),
        verticalArrangement = Arrangement.SpaceBetween) {
        for (v in 2 downTo 0) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                for (h in 0..2) {
                    val a = Anchor.entries.first { it.h == h && it.v == v }
                    Box(Modifier.size(32.dp).clip(CircleShape).background(if (a == selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                        .clickable { onSelect(a) })
                }
            }
        }
    }
}

/** Miniature de la première page (rendue en arrière-plan). */
@Composable
fun PdfThumbnail(file: File, modifier: Modifier = Modifier, page: Int = 0, widthPx: Int = 360) {
    var bmp by remember(file, page) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(file, page) { mutableStateOf(false) }
    LaunchedEffect(file, page) {
        bmp = withContext(Dispatchers.IO) { runCatching { PdfRender.renderPage(file, page, widthPx) }.onFailure { failed = true }.getOrNull() }
    }
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        val b = bmp
        when {
            b != null -> Image(b.asImageBitmap(), null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            failed -> Icon(Icons.Outlined.Lock, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, text: String, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(36.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (action != null) { Spacer(Modifier.height(16.dp)); action() }
    }
}

@Composable
fun Visible(visible: Boolean, content: @Composable () -> Unit) { AnimatedVisibility(visible) { content() } }
