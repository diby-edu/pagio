package com.pagio.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Construction
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.pagio.app.data.PickedFile
import com.pagio.app.tools.Screen
import com.pagio.app.tools.Tool
import com.pagio.app.ui.assistant.AssistantScreen
import com.pagio.app.ui.editor.EditorScreen
import com.pagio.app.ui.editor.FormsScreen
import com.pagio.app.ui.home.FilesScreen
import com.pagio.app.ui.home.HomeScreen
import com.pagio.app.ui.home.ToolsScreen
import com.pagio.app.ui.organize.OrganizeScreen
import com.pagio.app.ui.settings.AboutScreen
import com.pagio.app.ui.settings.AccountScreen
import com.pagio.app.ui.settings.AiSettingsScreen
import com.pagio.app.ui.settings.ServerSettingsScreen
import com.pagio.app.ui.settings.SettingsScreen
import com.pagio.app.ui.theme.PagioTheme
import com.pagio.app.ui.tool.Handoff
import com.pagio.app.ui.tool.ToolScreen
import com.pagio.app.ui.viewer.ViewerScreen
import kotlinx.coroutines.launch
import java.io.File
import java.net.URLDecoder
import java.net.URLEncoder

class MainActivity : ComponentActivity() {
    private var incoming by mutableStateOf<List<Uri>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleIntent(intent)
        setContent {
            val c = container
            val settings by c.settings.settings.collectAsState(initial = null)
            PagioTheme(settings?.theme ?: com.pagio.app.data.ThemeMode.SYSTEM, settings?.dynamicColor ?: false) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    PagioRoot(incoming) { incoming = emptyList() }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }

    /** Fichiers ouverts ou partagés depuis une autre application. */
    private fun handleIntent(intent: Intent?) {
        intent ?: return
        val uris = when (intent.action) {
            Intent.ACTION_VIEW -> listOfNotNull(intent.data)
            Intent.ACTION_SEND -> listOfNotNull(intentStream(intent))
            Intent.ACTION_SEND_MULTIPLE -> intentStreams(intent)
            else -> emptyList()
        }
        if (uris.isNotEmpty()) incoming = uris
    }

    @Suppress("DEPRECATION")
    private fun intentStream(i: Intent): Uri? = i.getParcelableExtra(Intent.EXTRA_STREAM)
    @Suppress("DEPRECATION")
    private fun intentStreams(i: Intent): List<Uri> = i.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
}

private data class Tab(val route: String, val icon: ImageVector, val label: Int)

private val tabs = listOf(
    Tab("home", Icons.Outlined.Home, R.string.nav_home),
    Tab("tools", Icons.Outlined.GridView, R.string.nav_tools),
    Tab("tool/assistant", Icons.Outlined.AutoAwesome, R.string.nav_ai),
    Tab("files", Icons.Outlined.Folder, R.string.nav_files),
    Tab("settings", Icons.Outlined.Settings, R.string.nav_settings),
)

fun viewerRoute(f: File) = "viewer?path=" + URLEncoder.encode(f.absolutePath, "UTF-8")

@Composable
fun PagioRoot(incoming: List<Uri>, onIncomingHandled: () -> Unit) {
    val context = LocalContext.current
    val c = context.container
    val nav = rememberNavController()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val settings by c.settings.settings.collectAsState(initial = null)
    val config by c.config.collectAsState()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val currentTab = when {
        route == "tool/{id}" && backStack?.arguments?.getString("id") == "assistant" -> "tool/assistant"
        else -> route
    }

    // --- Scanner (ML Kit : détection des bords, recadrage, filtres) ------------------------
    val scanner = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        val result = GmsDocumentScanningResult.fromActivityResultIntent(res.data) ?: return@rememberLauncherForActivityResult
        scope.launch {
            val pdf = result.pdf ?: return@launch
            val picked = c.workspace.import(pdf.uri, c.workspace.newOutputDir())
            val target = File(picked.file.parentFile, "scan_" + java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.ROOT).format(java.util.Date()) + ".pdf")
            picked.file.renameTo(target)
            c.history.add("scan", target.name, true, emptyList(), listOf(target), "${pdf.pageCount} page(s) numérisée(s)", 0)
            c.track("scan", mapOf("pages" to pdf.pageCount))
            nav.navigate(viewerRoute(target))
        }
    }
    val photoFile = remember { mutableStateOf<File?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = photoFile.value
        if (ok && f != null) { Handoff.files = listOf(PickedFile(f, f.name, f.length(), "image/jpeg")); nav.navigate("tool/images_to_pdf") }
    }
    fun startScan() {
        val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(100)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(context as Activity)
            .addOnSuccessListener { scanner.launch(IntentSenderRequest.Builder(it).build()) }
            .addOnFailureListener {
                // Repli sans services Google : photo simple puis conversion en PDF.
                val f = File(c.workspace.newTaskDir(), "photo_${System.currentTimeMillis()}.jpg")
                photoFile.value = f
                scope.launch { snackbar.showSnackbar(context.getString(R.string.scanner_fallback)) }
                camera.launch(c.workspace.uriFor(f))
            }
    }

    fun openTool(t: Tool) {
        if (t.screen == Screen.SCANNER) startScan() else nav.navigate("tool/${t.id}")
    }

    // Fichiers reçus d'une autre application : PDF → lecteur, images → Image en PDF.
    LaunchedEffect(incoming) {
        if (incoming.isEmpty()) return@LaunchedEffect
        val picked = incoming.map { c.workspace.import(it) }
        onIncomingHandled()
        when {
            picked.size == 1 && picked[0].isPdf -> nav.navigate(viewerRoute(picked[0].file))
            picked.all { it.isImage } -> { Handoff.files = picked; nav.navigate("tool/images_to_pdf") }
            picked.all { it.isPdf } -> { Handoff.files = picked; nav.navigate("tool/merge") }
            else -> { Handoff.files = picked; nav.navigate("tool/office_to_pdf") }
        }
    }

    // --- Contrôle à distance : maintenance et mise à jour obligatoire ----------------------
    if (config.minVersionCode > BuildConfig.VERSION_CODE) {
        Blocking(Icons.Outlined.SystemUpdate, stringResource(R.string.update_required), stringResource(R.string.update_required_d),
            if (config.updateUrl.isNotBlank()) stringResource(R.string.update_now) else null) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(config.updateUrl))) }
        }
        return
    }
    if (config.maintenance) {
        Blocking(Icons.Outlined.Construction, stringResource(R.string.maintenance), config.maintenanceMessage.ifBlank { stringResource(R.string.maintenance_d) },
            stringResource(R.string.retry)) { scope.launch { c.refreshServer() } }
        return
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (tabs.any { it.route == currentTab }) NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(selected = currentTab == tab.route, onClick = {
                        nav.navigate(tab.route) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true }
                    }, icon = { Icon(tab.icon, null) }, label = { Text(stringResource(tab.label)) })
                }
            }
        },
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
    ) { padding ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(padding)) {
            composable("home") { HomeScreen(onTool = ::openTool, onOpenFile = { nav.navigate(viewerRoute(it)) }, onSeeAll = { nav.navigate("tools") }) }
            composable("tools") { ToolsScreen(onTool = ::openTool) }
            composable("files") { FilesScreen(onOpenFile = { nav.navigate(viewerRoute(it)) }, onTool = ::openTool) }
            composable("settings") { SettingsScreen({ nav.navigate("account") }, { nav.navigate("ai") }, { nav.navigate("server") }, { nav.navigate("about") }) }
            composable("account") { AccountScreen { nav.popBackStack() } }
            composable("ai") { AiSettingsScreen { nav.popBackStack() } }
            composable("server") { ServerSettingsScreen { nav.popBackStack() } }
            composable("about") { AboutScreen { nav.popBackStack() } }
            composable("viewer?path={path}", arguments = listOf(navArgument("path") { type = NavType.StringType })) { entry ->
                val path = URLDecoder.decode(entry.arguments?.getString("path") ?: "", "UTF-8")
                ViewerScreen(File(path), onBack = { nav.popBackStack() }, onTool = ::openTool)
            }
            composable("tool/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
                val tool = Tool.byId(entry.arguments?.getString("id") ?: "") ?: Tool.MERGE
                val back: () -> Unit = { nav.popBackStack() }
                val open: (File) -> Unit = { nav.navigate(viewerRoute(it)) }
                val cont: (Tool) -> Unit = { t -> nav.popBackStack(); openTool(t) }
                when (tool.screen) {
                    Screen.ORGANIZE -> OrganizeScreen(back, open, cont)
                    Screen.EDITOR -> EditorScreen(tool, back, open, cont)
                    Screen.FORMS -> FormsScreen(back, open, cont) { nav.popBackStack(); nav.navigate("tool/edit") }
                    Screen.ASSISTANT -> AssistantScreen(tool, back) { nav.navigate("ai") }
                    else -> ToolScreen(tool, back, open, cont)
                }
            }
        }
    }

    // Premier lancement : consentement aux statistiques anonymes (désactivées par défaut).
    if (settings?.onboardingDone == false) {
        AlertDialog(onDismissRequest = {}, title = { Text(stringResource(R.string.welcome_title)) }, text = { Text(stringResource(R.string.welcome_text)) },
            confirmButton = { TextButton(onClick = { scope.launch { c.settings.setTelemetry(true); c.settings.setOnboardingDone() } }) { Text(stringResource(R.string.welcome_accept)) } },
            dismissButton = { TextButton(onClick = { scope.launch { c.settings.setOnboardingDone() } }) { Text(stringResource(R.string.welcome_refuse)) } })
    }
}

@Composable
private fun Blocking(icon: ImageVector, title: String, text: String, action: String?, onAction: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, null, Modifier.size(72.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
        if (action != null) { Spacer(Modifier.height(24.dp)); Button(onClick = onAction) { Text(action) } }
    }
}

@Suppress("unused") private fun keep(n: NavHostController) = n
