package com.pagio.app.ui.home

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.pagio.app.BuildConfig
import com.pagio.app.R
import com.pagio.app.container
import com.pagio.app.data.humanSize
import com.pagio.app.tools.Category
import com.pagio.app.tools.Tool
import com.pagio.app.ui.components.EmptyState
import com.pagio.app.ui.components.PdfThumbnail
import com.pagio.app.ui.components.SectionTitle
import com.pagio.app.ui.components.ToolIcon
import com.pagio.app.ui.components.ToolTile
import com.pagio.app.ui.theme.Brand
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale

@Composable
fun HomeScreen(onTool: (Tool) -> Unit, onOpenFile: (File) -> Unit, onSeeAll: () -> Unit) {
    val c = LocalContext.current.container
    val settings by c.settings.settings.collectAsState(initial = null)
    val history by c.history.entries.collectAsState()
    val config by c.config.collectAsState()
    var dismissed by rememberSaveable { mutableStateOf(false) }
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    val favorites = (settings?.favorites ?: emptyList()).mapNotNull { Tool.byId(it) }

    LazyVerticalGrid(GridCells.Adaptive(160.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(Modifier.fillMaxWidth().background(if (dark) Brand.heroGradientDark else Brand.heroGradient, RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp))
                .statusBarsPadding().padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Color.White), contentAlignment = Alignment.Center) {
                        Text("P", color = Brand.Indigo, style = MaterialTheme.typography.titleLarge)
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(stringResource(R.string.app_name), color = Color.White, style = MaterialTheme.typography.titleLarge)
                }
                Spacer(Modifier.height(18.dp))
                Text(stringResource(R.string.home_title), color = Color.White, style = MaterialTheme.typography.headlineMedium)
                Text(stringResource(R.string.home_subtitle), color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(16.dp))
                Surface(onClick = onSeeAll, shape = RoundedCornerShape(16.dp), color = Color.White.copy(alpha = 0.18f), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Search, null, tint = Color.White)
                        Spacer(Modifier.width(10.dp))
                        Text(stringResource(R.string.search_tools), color = Color.White.copy(alpha = 0.9f))
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    QuickAction(Tool.SCAN, Modifier.weight(1f), onTool)
                    QuickAction(Tool.EDIT, Modifier.weight(1f), onTool)
                    QuickAction(Tool.ASSISTANT, Modifier.weight(1f), onTool)
                }
            }
        }
        if (config.minVersionCode > 0 && BuildConfig.VERSION_CODE < config.minVersionCode) Unit
        else if (config.latestVersionName.isNotBlank() && config.latestVersionName != BuildConfig.VERSION_NAME) item(span = { GridItemSpan(maxLineSpan) }) {
            Banner(Icons.Outlined.SystemUpdate, stringResource(R.string.update_available, config.latestVersionName), MaterialTheme.colorScheme.tertiaryContainer, null)
        }
        if (config.announcement.isNotBlank() && !dismissed) item(span = { GridItemSpan(maxLineSpan) }) {
            Banner(if (config.announcementLevel == "warning") Icons.Outlined.ErrorOutline else Icons.Outlined.Campaign, config.announcement,
                if (config.announcementLevel == "warning") MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer) { dismissed = true }
        }
        item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle(stringResource(R.string.favorites), Modifier.padding(horizontal = 16.dp)) { TextButton(onClick = onSeeAll) { Text(stringResource(R.string.all_tools)) } } }
        items(favorites, key = { "fav_" + it.id }) { t -> Box(Modifier.padding(horizontal = 4.dp)) { ToolTile(t, Modifier.padding(horizontal = 12.dp), favorite = true) { onTool(t) } } }

        item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle(stringResource(R.string.popular), Modifier.padding(horizontal = 16.dp)) }
        items(listOf(Tool.MERGE, Tool.COMPRESS, Tool.PDF_TO_WORD, Tool.IMAGES_TO_PDF, Tool.SPLIT, Tool.SIGN).filter { it !in favorites }, key = { "pop_" + it.id }) { t ->
            Box(Modifier.padding(horizontal = 12.dp)) { ToolTile(t) { onTool(t) } }
        }

        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                SectionTitle(stringResource(R.string.recent_files))
                val recent = history.filter { it.success }.flatMap { e -> e.existingOutputs.filter { it.extension.equals("pdf", true) } }.distinct().take(10)
                if (recent.isEmpty()) Text(stringResource(R.string.no_recent), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                else LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(recent, key = { it.absolutePath }) { f ->
                        Column(Modifier.width(110.dp).clip(RoundedCornerShape(12.dp)).combinedClickable(onClick = { onOpenFile(f) })) {
                            PdfThumbnail(f, Modifier.size(110.dp, 140.dp), widthPx = 240)
                            Text(f.name, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickAction(tool: Tool, modifier: Modifier, onTool: (Tool) -> Unit) {
    Surface(onClick = { onTool(tool) }, shape = RoundedCornerShape(16.dp), color = Color.White, modifier = modifier) {
        Column(Modifier.padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(tool.icon, null, tint = tool.category.color, modifier = Modifier.size(26.dp))
            Spacer(Modifier.height(4.dp))
            Text(stringResource(tool.title), style = MaterialTheme.typography.labelMedium, color = Brand.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun Banner(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, color: Color, onClose: (() -> Unit)?) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp), colors = CardDefaults.cardColors(containerColor = color)) {
        Row(Modifier.padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null); Spacer(Modifier.width(10.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            if (onClose != null) IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, stringResource(R.string.close)) }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ToolsScreen(onTool: (Tool) -> Unit) {
    val c = LocalContext.current.container
    val settings by c.settings.settings.collectAsState(initial = null)
    val config by c.config.collectAsState()
    val scope = rememberCoroutineScope()
    var query by rememberSaveable { mutableStateOf("") }
    val ctx = LocalContext.current
    val favorites = settings?.favorites ?: emptyList()
    val visible = Tool.entries.filter { config.tool(it.id).enabled }
        .filter { t -> query.isBlank() || ctx.getString(t.title).contains(query, true) || ctx.getString(t.desc).contains(query, true) }

    LazyVerticalGrid(GridCells.Adaptive(160.dp), Modifier.fillMaxSize().statusBarsPadding(), contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                Text(stringResource(R.string.all_tools), style = MaterialTheme.typography.headlineMedium)
                Text(stringResource(R.string.tools_count, Tool.entries.size), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { Text(stringResource(R.string.search_tools)) },
                    leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, shape = RoundedCornerShape(16.dp))
                Text(stringResource(R.string.long_press_favorite), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
        }
        Category.entries.forEach { cat ->
            val tools = visible.filter { it.category == cat }
            if (tools.isEmpty()) return@forEach
            item(span = { GridItemSpan(maxLineSpan) }, key = "cat_${cat.name}") {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(cat.color)); Spacer(Modifier.width(8.dp))
                    Text(stringResource(cat.title), style = MaterialTheme.typography.titleMedium)
                }
            }
            items(tools, key = { it.id }) { t ->
                val isFav = t.id in favorites
                Box(Modifier.combinedClickable(onClick = { onTool(t) }, onLongClick = {
                    scope.launch { c.settings.setFavorites(if (isFav) favorites - t.id else (favorites + t.id).takeLast(8)) }
                })) {
                    ToolTile(t, favorite = isFav, onClick = { onTool(t) })
                    if (config.tool(t.id).premium) Text("PREMIUM", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.align(Alignment.TopEnd).padding(10.dp))
                }
            }
        }
    }
}

@Composable
fun FilesScreen(onOpenFile: (File) -> Unit, onTool: (Tool) -> Unit) {
    val c = LocalContext.current.container
    val ctx = LocalContext.current
    val history by c.history.entries.collectAsState()
    val scope = rememberCoroutineScope()
    val fmt = remember { SimpleDateFormat("dd MMM yyyy · HH:mm", Locale.FRANCE) }
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().statusBarsPadding(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.nav_files), style = MaterialTheme.typography.headlineMedium)
                    Text(stringResource(R.string.files_subtitle), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (history.isNotEmpty()) TextButton(onClick = { scope.launch { c.history.clear(deleteFiles = false) } }) { Text(stringResource(R.string.clear_history)) }
            }
        }
        if (history.isEmpty()) item {
            EmptyState(Icons.Outlined.FolderOpen, stringResource(R.string.no_history), stringResource(R.string.no_history_d)) {
                androidx.compose.material3.Button(onClick = { onTool(Tool.SCAN) }) { Icon(Icons.Outlined.DocumentScanner, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.t_scan)) }
            }
        }
        items(history, key = { it.id }) { e ->
            val tool = Tool.byId(e.toolId)
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (tool != null) ToolIcon(tool, 36)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(tool?.let { stringResource(it.title) } ?: e.toolId, style = MaterialTheme.typography.titleSmall)
                            Text(fmt.format(e.createdAt) + " · " + (e.durationMs / 1000.0).let { "%.1f s".format(Locale.FRANCE, it) }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        IconButton(onClick = { scope.launch { c.history.delete(e.id, deleteFiles = true) } }) { Icon(Icons.Outlined.Close, stringResource(R.string.delete)) }
                    }
                    Text(e.message ?: "", style = MaterialTheme.typography.bodySmall, color = if (e.success) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
                    e.existingOutputs.forEach { f ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).combinedClickable(onClick = {
                            if (f.extension.equals("pdf", true)) onOpenFile(f) else runCatching { ctx.startActivity(c.workspace.openWithIntent(f)) }
                        }).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("• " + f.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(f.length().humanSize(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (e.success && e.outputs.isNotEmpty() && e.existingOutputs.isEmpty()) Text(stringResource(R.string.files_deleted), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
