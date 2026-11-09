package com.pagio.app.ui.viewer

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.pagio.app.R
import com.pagio.app.container
import com.pagio.app.data.PickedFile
import com.pagio.app.tools.Tool
import com.pagio.app.ui.components.ErrorCard
import com.pagio.app.ui.tool.Handoff
import com.pagio.app.ui.tool.humanError
import com.pagio.engine.PdfRender
import com.pagio.engine.PdfText
import com.pagio.engine.SearchHit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Lecteur PDF : pages rendues à la demande, zoom au pincement, recherche plein texte. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViewerScreen(file: File, onBack: () -> Unit, onTool: (Tool) -> Unit) {
    val context = LocalContext.current
    val c = context.container
    var sizes by remember { mutableStateOf<List<Pair<Int, Int>>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val hits = remember { mutableStateListOf<SearchHit>() }
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val widthPx = (LocalConfiguration.current.screenWidthDp * context.resources.displayMetrics.density).toInt().coerceAtMost(1600)
    val currentPage by remember { derivedStateOf { listState.firstVisibleItemIndex + 1 } }

    LaunchedEffect(file) {
        withContext(Dispatchers.IO) { runCatching { PdfRender.pageSizes(file) } }.onSuccess { sizes = it }.onFailure { error = humanError(it) }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(file.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) } },
            actions = {
                IconButton(onClick = { searching = !searching }) { Icon(Icons.Outlined.Search, stringResource(R.string.search)) }
                IconButton(onClick = { Handoff.files = listOf(PickedFile(file, file.name, file.length(), "application/pdf")); onTool(Tool.EDIT) }) { Icon(Icons.Outlined.EditNote, stringResource(R.string.t_edit)) }
                IconButton(onClick = { context.startActivity(c.workspace.shareIntent(listOf(file))) }) { Icon(Icons.Outlined.Share, stringResource(R.string.share)) }
                IconButton(onClick = { runCatching { context.startActivity(c.workspace.openWithIntent(file)) } }) { Icon(Icons.Outlined.OpenInNew, stringResource(R.string.open_with)) }
            },
        )
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (searching) {
                OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(8.dp), singleLine = true,
                    placeholder = { Text(stringResource(R.string.search_in_doc)) },
                    trailingIcon = { IconButton(onClick = {
                        scope.launch {
                            hits.clear()
                            hits.addAll(withContext(Dispatchers.IO) { runCatching { PdfText.search(file, query) }.getOrDefault(emptyList()) })
                        }
                    }) { Icon(Icons.Outlined.Search, null) } })
                if (hits.isNotEmpty()) LazyColumn(Modifier.fillMaxWidth().heightIn(max = 180.dp)) {
                    itemsIndexed(hits) { _, h ->
                        Text("p. ${h.page} — …${h.snippet}…", style = MaterialTheme.typography.bodySmall, maxLines = 2,
                            modifier = Modifier.fillMaxWidth().clickable { scope.launch { listState.animateScrollToItem(h.page - 1) } }.padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                } else if (query.isNotBlank()) Text(stringResource(R.string.search_hint_ocr), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 12.dp))
            }
            error?.let { ErrorCard(it, Modifier.padding(16.dp)) }
            val s = sizes
            if (s == null && error == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            if (s != null) Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant)) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize()
                        .pointerInput(Unit) {
                            detectTransformGestures { _, pan, zoom, _ ->
                                scale = (scale * zoom).coerceIn(1f, 4f)
                                offsetX = if (scale == 1f) 0f else (offsetX + pan.x).coerceIn(-size.width * (scale - 1) / 2, size.width * (scale - 1) / 2)
                            }
                        }
                        .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offsetX),
                    contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    itemsIndexed(s) { i, (w, h) -> PageImage(file, i, w, h, widthPx) }
                }
                Surface(Modifier.align(Alignment.BottomCenter).padding(16.dp), shape = MaterialTheme.shapes.extraLarge, color = Color.Black.copy(alpha = 0.65f)) {
                    Text("$currentPage / ${s.size}", color = Color.White, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun PageImage(file: File, index: Int, w: Int, h: Int, widthPx: Int) {
    var bmp by remember(file, index) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(file, index) {
        bmp = withContext(Dispatchers.IO) { runCatching { PdfRender.renderPage(file, index, widthPx) }.getOrNull() }
    }
    Box(Modifier.fillMaxWidth().aspectRatio(w.toFloat() / h).background(Color.White), contentAlignment = Alignment.Center) {
        bmp?.let { Image(it.asImageBitmap(), stringResource(R.string.page_n, index + 1), Modifier.fillMaxSize()) } ?: CircularProgressIndicator()
    }
}

@Suppress("unused") private val keepRow: @Composable () -> Unit = { Row {} }
