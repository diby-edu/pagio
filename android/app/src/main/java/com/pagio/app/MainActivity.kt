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
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.moduleinstall.InstallStatusListener
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.android.gms.common.moduleinstall.ModuleInstallStatusUpdate
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
import com.pagio.app.ui.scan.ScanNameDialog
import com.pagio.app.ui.scan.ScanScreen
import com.pagio.app.ui.scan.renameScan
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
    // Scan validé en attente de son nom : chemin du PDF et nombre de pages. Conservé si Android ferme l'application.
    var namingPath by rememberSaveable { mutableStateOf<String?>(null) }
    var namingPages by rememberSaveable { mutableIntStateOf(0) }
    fun askScanName(file: File, pages: Int) { namingPages = pages; namingPath = file.absolutePath }

    // Heure du dernier scan réussi [0] et du dernier appui sur « Scanner » [1].
    val scanTimes = remember { longArrayOf(0L, 0L) }
    val scanner = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode != Activity.RESULT_OK) {
            // Un scan vient de réussir : ce second retour « sans document » (double appui, écran de Google fermé
            // en deux temps) ne doit pas afficher de message d'échec par-dessus le document obtenu.
            if (System.currentTimeMillis() - scanTimes[0] < 8000) return@rememberLauncherForActivityResult
            // Fermé sans résultat : abandon volontaire, ou écran d'erreur des services Google (« Une erreur s'est
            // produite »), que l'application ne peut pas distinguer. On propose donc le scanner de Pagio sans l'imposer.
            c.track("scan_closed", mapOf("ok" to false))
            scope.launch {
                // Durée courte imposée : un message doté d'un bouton reste sinon affiché sans fin, et se retrouvait
                // encore à l'écran après un scan réussi fait juste ensuite.
                val r = snackbar.showSnackbar(context.getString(R.string.scanner_closed), context.getString(R.string.scanner_use_pagio), duration = SnackbarDuration.Short)
                if (r == SnackbarResult.ActionPerformed) nav.navigate("scan")
            }
            return@rememberLauncherForActivityResult
        }
        val result = GmsDocumentScanningResult.fromActivityResultIntent(res.data) ?: return@rememberLauncherForActivityResult
        // Scan réussi : un éventuel message « fermé sans document » n'a plus lieu d'être.
        scanTimes[0] = System.currentTimeMillis()
        snackbar.currentSnackbarData?.dismiss()
        scope.launch {
            val pdf = result.pdf ?: return@launch
            val picked = c.workspace.import(pdf.uri, c.workspace.newOutputDir())
            c.track("scan", mapOf("pages" to pdf.pageCount, "engine" to "google"))
            askScanName(picked.file, pdf.pageCount)
        }
    }
    fun startScan() {
        val activity = context as Activity
        // Deux appuis rapprochés ouvriraient deux scanners l'un sur l'autre : le second est ignoré.
        val tapped = System.currentTimeMillis()
        if (tapped - scanTimes[1] < 1500) return
        scanTimes[1] = tapped
        // Sans services Google Play utilisables (téléphone sans Google, services désactivés ou trop anciens), toute
        // tentative ferait apparaître une alerte de Google « Activer les services Google Play ». On ne les sollicite
        // donc pas : le scanner de Pagio s'ouvre directement.
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) != ConnectionResult.SUCCESS) {
            nav.navigate("scan"); return
        }
        val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(c.scanPageLimit().takeIf { it > 0 }?.coerceAtMost(100) ?: 100)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
        val client = GmsDocumentScanning.getClient(options)
        // Relais : le scanner de Pagio (détection des bords intégrée, sans services Google). La raison est remontée
        // aux statistiques : sans elle, l'échec du scanner de Google est impossible à diagnostiquer.
        fun fallback(reason: String) {
            c.track("scan_unavailable", mapOf("ok" to false, "error" to reason.take(160)))
            nav.navigate("scan")
        }
        fun open() {
            client.getStartScanIntent(activity)
                .addOnSuccessListener { scanner.launch(IntentSenderRequest.Builder(it).build()) }
                .addOnFailureListener { e -> fallback(e.message ?: e.javaClass.simpleName) }
        }
        // Le scanner de Google est un module que les services Google Play téléchargent à part. S'il n'est pas là, on
        // n'attend pas : le scanner de Pagio s'ouvre tout de suite et le téléchargement est demandé en arrière-plan,
        // pour une prochaine fois. Sur certains téléphones ce téléchargement échoue toujours (code 8 constaté).
        val modules = ModuleInstall.getClient(activity)
        modules.areModulesAvailable(client)
            .addOnSuccessListener { availability ->
                if (availability.areModulesAvailable()) { open(); return@addOnSuccessListener }
                nav.navigate("scan")
                val listener = object : InstallStatusListener {
                    override fun onInstallStatusUpdated(update: ModuleInstallStatusUpdate) {
                        when (update.installState) {
                            ModuleInstallStatusUpdate.InstallState.STATE_COMPLETED -> modules.unregisterListener(this)
                            ModuleInstallStatusUpdate.InstallState.STATE_FAILED, ModuleInstallStatusUpdate.InstallState.STATE_CANCELED -> {
                                modules.unregisterListener(this)
                                c.track("scan_unavailable", mapOf("ok" to false, "error" to "module Google non installé (code ${update.errorCode})"))
                            }
                            else -> Unit
                        }
                    }
                }
                modules.installModules(ModuleInstallRequest.newBuilder().addApi(client).setListener(listener).build())
                    .addOnFailureListener { e ->
                        modules.unregisterListener(listener)
                        c.track("scan_unavailable", mapOf("ok" to false, "error" to (e.message ?: e.javaClass.simpleName).take(160)))
                    }
            }
            // Vérification impossible : inutile d'insister auprès de Google, le scanner de Pagio prend le relais.
            .addOnFailureListener { e -> fallback(e.message ?: e.javaClass.simpleName) }
    }

    // Limite gratuite du jour atteinte : on prévient avant d'ouvrir l'outil, jamais au milieu d'un travail.
    var limitMessage by remember { mutableStateOf<String?>(null) }
    fun openTool(t: Tool) {
        scope.launch {
            c.freeLimitMessage(t.id)?.let { limitMessage = it; return@launch }
            if (t.screen == Screen.SCANNER) startScan() else nav.navigate("tool/${t.id}")
        }
    }

    // Fichiers reçus d'une autre application : PDF → lecteur, images → Image en PDF.
    LaunchedEffect(incoming) {
        if (incoming.isEmpty()) return@LaunchedEffect
        // Un fichier illisible ou refusé ne doit pas faire planter l'application : il est simplement ignoré.
        val picked = incoming.mapNotNull { runCatching { c.workspace.import(it) }.getOrNull() }
        onIncomingHandled()
        if (picked.isEmpty()) { snackbar.showSnackbar(context.getString(R.string.incoming_unreadable)); return@LaunchedEffect }
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
            composable("scan") { ScanScreen(onBack = { nav.popBackStack() }, onDone = { f, n -> nav.popBackStack(); askScanName(f, n) }) }
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

    // Après chaque scan : nommer le document, l'enregistrer dans Fichiers, puis y aller.
    namingPath?.let { path ->
        ScanNameDialog(namingPages) { name ->
            namingPath = null
            scope.launch {
                val source = File(path)
                if (!source.exists()) return@launch
                val saved = withContext(Dispatchers.IO) { renameScan(source, name) }
                c.recordToolUse("scan") // 1 scan = 1 document enregistré, quel que soit le nombre de pages
                c.history.add("scan", saved.name, true, emptyList(), listOf(saved), "${namingPages} page(s) numérisée(s)", 0)
                nav.navigate("files") { popUpTo("home") { saveState = true }; launchSingleTop = true }
                snackbar.showSnackbar(context.getString(R.string.scan_saved_as, saved.name), duration = SnackbarDuration.Short)
            }
        }
    }

    limitMessage?.let { msg ->
        AlertDialog(onDismissRequest = { limitMessage = null }, title = { Text(stringResource(R.string.limit_title)) }, text = { Text(msg) },
            confirmButton = { TextButton(onClick = { limitMessage = null }) { Text(stringResource(android.R.string.ok)) } })
    }

    // Premier lancement : consentement aux statistiques (désactivées par défaut).
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
