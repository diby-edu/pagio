package com.pagio.app.ui.settings

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CleaningServices
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Feedback
import androidx.compose.material.icons.outlined.Gavel
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Policy
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.unit.dp
import com.pagio.ai.AiConfig
import com.pagio.ai.AiProviders
import com.pagio.ai.ChatMessage
import com.pagio.ai.ProviderType
import com.pagio.app.BuildConfig
import com.pagio.app.R
import com.pagio.app.ServerState
import com.pagio.app.container
import com.pagio.app.data.ThemeMode
import com.pagio.app.data.humanSize
import com.pagio.app.ui.components.ChoiceChips
import com.pagio.app.ui.components.ErrorCard
import com.pagio.app.ui.components.InfoCard
import com.pagio.app.ui.components.PasswordField
import com.pagio.app.ui.components.SectionTitle
import com.pagio.app.ui.components.SwitchRow
import com.pagio.app.ui.tool.humanError
import kotlinx.coroutines.launch

@Composable
private fun SettingRow(icon: ImageVector, title: String, subtitle: String? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.outline)
    }
}

@Composable
fun SettingsScreen(onAccount: () -> Unit, onAi: () -> Unit, onServer: () -> Unit, onAbout: () -> Unit) {
    val context = LocalContext.current
    val c = context.container
    val s by c.settings.settings.collectAsState(initial = null)
    val account by c.account.collectAsState()
    val server by c.server.collectAsState()
    val scope = rememberCoroutineScope()
    var usage by remember { mutableStateOf(0L to 0L) }
    var cleaned by remember { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf(false) }
    LaunchedEffect(cleaned) { usage = c.workspace.usedBytes() }
    val settings = s ?: return

    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Text(stringResource(R.string.nav_settings), style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(vertical = 12.dp))
        Card(onClick = onAccount, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (account?.isPremium == true) Icons.Outlined.WorkspacePremium else Icons.Outlined.AccountCircle, null, Modifier.size(40.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(account?.name?.ifBlank { account?.email } ?: stringResource(R.string.not_signed_in), style = MaterialTheme.typography.titleMedium)
                    Text(account?.let { stringResource(R.string.plan_line, if (it.isPremium) "Premium" else stringResource(R.string.plan_free), it.aiCredits) } ?: stringResource(R.string.sign_in_benefits),
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        SectionTitle(stringResource(R.string.appearance))
        Text(stringResource(R.string.theme), style = MaterialTheme.typography.bodyLarge)
        ChoiceChips(listOf(ThemeMode.SYSTEM to stringResource(R.string.theme_system), ThemeMode.LIGHT to stringResource(R.string.theme_light), ThemeMode.DARK to stringResource(R.string.theme_dark)),
            settings.theme, { m -> scope.launch { c.settings.setTheme(m) } })
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) SwitchRow(stringResource(R.string.dynamic_colors), settings.dynamicColor, { v -> scope.launch { c.settings.setDynamicColor(v) } }, stringResource(R.string.dynamic_colors_d))
        SettingRow(Icons.Outlined.Language, stringResource(R.string.language), stringResource(R.string.language_d)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) runCatching {
                context.startActivity(Intent(Settings.ACTION_APP_LOCALE_SETTINGS, Uri.fromParts("package", context.packageName, null)))
            } else context.startActivity(Intent(Settings.ACTION_LOCALE_SETTINGS))
        }
        HorizontalDivider()
        SectionTitle(stringResource(R.string.intelligence))
        SettingRow(Icons.Outlined.AutoAwesome, stringResource(R.string.ai_provider), settings.ai.type.label, onAi)
        SettingRow(Icons.Outlined.Cloud, stringResource(R.string.server), stringResource(when (server) {
            ServerState.ONLINE -> R.string.server_online; ServerState.OFFLINE -> R.string.server_offline; ServerState.NOT_CONFIGURED -> R.string.server_none; else -> R.string.server_unknown
        }), onServer)
        HorizontalDivider()
        SectionTitle(stringResource(R.string.privacy_storage))
        SwitchRow(stringResource(R.string.telemetry), settings.telemetry, { v -> scope.launch { c.settings.setTelemetry(v) } }, stringResource(R.string.telemetry_d))
        SwitchRow(stringResource(R.string.auto_save), settings.autoSaveToDownloads, { v -> scope.launch { c.settings.setAutoSave(v) } }, stringResource(R.string.auto_save_d))
        SettingRow(Icons.Outlined.CleaningServices, stringResource(R.string.clean_temp), stringResource(R.string.storage_line, usage.first.humanSize(), usage.second.humanSize())) {
            val freed = c.workspace.cleanTemp(0); cleaned = freed.humanSize()
        }
        cleaned?.let { Text(stringResource(R.string.cleaned, it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary) }
        HorizontalDivider()
        SectionTitle(stringResource(R.string.about))
        SettingRow(Icons.Outlined.Feedback, stringResource(R.string.feedback), stringResource(R.string.feedback_d)) { feedback = true }
        SettingRow(Icons.Outlined.Info, stringResource(R.string.about_app), "Pagio ${BuildConfig.VERSION_NAME}", onAbout)
        Spacer(Modifier.height(32.dp))
    }
    if (feedback) FeedbackDialog { feedback = false }
}

@Composable
private fun FeedbackDialog(onClose: () -> Unit) {
    val c = LocalContext.current.container
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf("suggestion") }
    var message by remember { mutableStateOf("") }
    var email by remember { mutableStateOf(c.account.value?.email ?: "") }
    var status by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onClose, title = { Text(stringResource(R.string.feedback)) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ChoiceChips(listOf("suggestion" to stringResource(R.string.fb_suggestion), "bug" to stringResource(R.string.fb_bug), "contact" to stringResource(R.string.fb_contact)), kind, { kind = it })
            OutlinedTextField(message, { message = it }, label = { Text(stringResource(R.string.fb_message)) }, minLines = 4, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(email, { email = it }, label = { Text(stringResource(R.string.email_optional)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }, confirmButton = {
        TextButton(enabled = message.length >= 5, onClick = {
            scope.launch {
                status = try { c.backend.feedback(kind, message, email.ifBlank { null }); onClose(); null } catch (e: Exception) { humanError(e) }
            }
        }) { Text(stringResource(R.string.send)) }
    }, dismissButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.cancel)) } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubScreen(title: String, onBack: () -> Unit, snackbar: SnackbarHostState? = null, content: @Composable () -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text(title) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) } }) },
        snackbarHost = { snackbar?.let { SnackbarHost(it) } }) { p ->
        Column(Modifier.padding(p).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
    }
}

@Composable
fun AiSettingsScreen(onBack: () -> Unit) {
    val c = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val current by c.settings.settings.collectAsState(initial = null)
    val config by c.config.collectAsState()
    var type by remember(current) { mutableStateOf(current?.ai?.type ?: ProviderType.NONE) }
    var base by remember(current) { mutableStateOf(current?.ai?.baseUrl ?: "") }
    var model by remember(current) { mutableStateOf(current?.ai?.model ?: "") }
    var key by remember(current) { mutableStateOf(current?.ai?.apiKey ?: "") }
    var status by remember { mutableStateOf<String?>(null) }
    var testing by remember { mutableStateOf(false) }
    SubScreen(stringResource(R.string.ai_provider), onBack) {
        InfoCard(stringResource(R.string.ai_settings_info))
        ChoiceChips(ProviderType.entries.map { it to it.label }, type, { type = it; status = null })
        if (type == ProviderType.PAGIO_SERVER) {
            InfoCard(stringResource(if (config.aiEnabled) R.string.ai_server_on else R.string.ai_server_off))
        } else if (type != ProviderType.NONE) {
            OutlinedTextField(base, { base = it }, label = { Text(stringResource(R.string.api_base_url)) }, placeholder = { Text(type.defaultBaseUrl) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(model, { model = it }, label = { Text(stringResource(R.string.model)) }, placeholder = { Text(type.defaultModel) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            PasswordField(key, { key = it }, stringResource(R.string.api_key))
            if (type == ProviderType.OPENAI_COMPATIBLE) Text(stringResource(R.string.openai_compat_examples), style = MaterialTheme.typography.bodySmall)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { scope.launch { c.settings.setAi(AiConfig(type, base, key, model)); status = "Enregistré." } }) { Text(stringResource(R.string.save)) }
            OutlinedButton(enabled = type != ProviderType.NONE && !testing, onClick = {
                scope.launch {
                    testing = true
                    val cfg = AiConfig(type, base, key, model, maxOutputTokens = 30)
                    status = try {
                        val p = AiProviders.create(cfg, current?.serverUrl, c.settings.token()) ?: error("Fournisseur non disponible")
                        "✔ " + p.complete("Réponds en un mot.", listOf(ChatMessage("user", "Dis bonjour."))).take(60)
                    } catch (e: Exception) { "✘ " + humanError(e) }
                    testing = false
                }
            }) { Text(stringResource(if (testing) R.string.testing else R.string.test)) }
        }
        status?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        Text(stringResource(R.string.key_storage_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun ServerSettingsScreen(onBack: () -> Unit) {
    val c = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val current by c.settings.settings.collectAsState(initial = null)
    val server by c.server.collectAsState()
    val config by c.config.collectAsState()
    var url by remember(current) { mutableStateOf(current?.serverUrl ?: "") }
    SubScreen(stringResource(R.string.server), onBack) {
        InfoCard(stringResource(R.string.server_info))
        OutlinedTextField(url, { url = it }, label = { Text(stringResource(R.string.server_url)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(onClick = { scope.launch { c.settings.setServerUrl(url); c.refreshServer() } }) { Text(stringResource(R.string.connect)) }
        Text(stringResource(R.string.status_line, stringResource(when (server) {
            ServerState.ONLINE -> R.string.server_online; ServerState.OFFLINE -> R.string.server_offline; ServerState.NOT_CONFIGURED -> R.string.server_none; else -> R.string.server_unknown
        })), style = MaterialTheme.typography.titleSmall)
        if (server == ServerState.ONLINE) {
            Text(stringResource(R.string.server_features, if (config.aiEnabled) "✔" else "✘", if (config.serverConversion) "✔" else "✘"), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
fun AccountScreen(onBack: () -> Unit) {
    val c = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val account by c.account.collectAsState()
    val server by c.server.collectAsState()
    val config by c.config.collectAsState()
    var register by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    SubScreen(stringResource(R.string.account), onBack) {
        val acc = account
        if (acc != null) {
            Card { Column(Modifier.padding(16.dp)) {
                Text(acc.name.ifBlank { acc.email }, style = MaterialTheme.typography.titleLarge)
                Text(acc.email, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.plan_line, if (acc.isPremium) "Premium" else stringResource(R.string.plan_free), acc.aiCredits), style = MaterialTheme.typography.titleSmall)
                acc.premiumUntil?.let { Text(stringResource(R.string.premium_until, it), style = MaterialTheme.typography.bodySmall) }
                val lim = if (acc.isPremium) config.premiumLimits else config.freeLimits
                Text(stringResource(R.string.limits_line, if (lim.dailyTasks > 0) lim.dailyTasks.toString() else "∞", if (lim.maxMb > 0) "${lim.maxMb} Mo" else "∞"), style = MaterialTheme.typography.bodySmall)
            } }
            InfoCard(stringResource(R.string.premium_info))
            OutlinedButton(onClick = { scope.launch { c.logout() } }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.log_out)) }
            TextButton(onClick = { confirmDelete = true }) { Text(stringResource(R.string.delete_account), color = MaterialTheme.colorScheme.error) }
        } else {
            if (server != ServerState.ONLINE) ErrorCard(stringResource(R.string.account_needs_server))
            InfoCard(stringResource(R.string.account_optional))
            ChoiceChips(listOf(false to stringResource(R.string.sign_in), true to stringResource(R.string.create_account)), register, { register = it })
            if (register) OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(email, { email = it.trim() }, label = { Text(stringResource(R.string.email)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            PasswordField(password, { password = it }, stringResource(R.string.password))
            error?.let { ErrorCard(it) }
            Button(enabled = !busy && email.contains('@') && password.length >= 8, onClick = {
                scope.launch {
                    busy = true; error = null
                    try { c.login(email, password, register, name) } catch (e: Exception) { error = humanError(e) }
                    busy = false
                }
            }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(if (register) R.string.create_account else R.string.sign_in)) }
            Text(stringResource(R.string.password_rule), style = MaterialTheme.typography.bodySmall)
            if (!register) TextButton(onClick = {
                scope.launch { error = try { c.backend.requestPasswordReset(email) } catch (e: Exception) { humanError(e) } }
            }, enabled = email.contains('@')) { Text(stringResource(R.string.forgot_password)) }
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text(stringResource(R.string.delete_account)) },
        text = { Text(stringResource(R.string.delete_account_d)) },
        confirmButton = { TextButton(onClick = { scope.launch { runCatching { c.deleteAccount() }; confirmDelete = false } }) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } })
}

/** Bibliothèques utilisées et leurs licences (affichées dans l'application). */
val LICENSES = listOf(
    Triple("Jetpack Compose, AndroidX", "Google", "Apache 2.0"),
    Triple("Kotlin, kotlinx.coroutines", "JetBrains", "Apache 2.0"),
    Triple("PdfBox-Android", "Tom Roush / Apache PDFBox", "Apache 2.0"),
    Triple("Bouncy Castle", "Legion of the Bouncy Castle", "MIT"),
    Triple("ML Kit (texte, langue, traduction, scanner)", "Google", "Conditions ML Kit (gratuit)"),
    Triple("Reorderable", "Calvin Liang", "Apache 2.0"),
    Triple("Material Symbols", "Google", "Apache 2.0"),
)

@Composable
fun AboutScreen(onBack: () -> Unit) {
    SubScreen(stringResource(R.string.about_app), onBack) {
        Text("Pagio", style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.version_line, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE), style = MaterialTheme.typography.bodyMedium)
        Text(stringResource(R.string.about_text), style = MaterialTheme.typography.bodyMedium)
        SectionTitle(stringResource(R.string.privacy))
        androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.Top) { Icon(Icons.Outlined.Policy, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.privacy_text), style = MaterialTheme.typography.bodySmall) }
        SectionTitle(stringResource(R.string.licenses))
        LICENSES.forEach { (name, author, lic) ->
            androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Icon(Icons.Outlined.Gavel, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                Column { Text(name, style = MaterialTheme.typography.bodyMedium); Text("$author — $lic", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

@Suppress("unused") private val keepDark = Icons.Outlined.DarkMode
