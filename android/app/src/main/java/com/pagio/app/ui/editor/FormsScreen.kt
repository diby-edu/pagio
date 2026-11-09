package com.pagio.app.ui.editor

import android.app.Application
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pagio.app.R
import com.pagio.app.container
import com.pagio.app.tools.Tool
import com.pagio.app.tools.ToolResult
import com.pagio.app.ui.components.EmptyState
import com.pagio.app.ui.components.ErrorCard
import com.pagio.app.ui.components.InfoCard
import com.pagio.app.ui.components.PasswordDialog
import com.pagio.app.ui.components.ProgressDialog
import com.pagio.app.ui.components.SwitchRow
import com.pagio.app.ui.tool.Handoff
import com.pagio.app.ui.tool.ResultPanel
import com.pagio.app.ui.tool.TaskState
import com.pagio.app.ui.tool.ToolViewModel
import com.pagio.engine.FormFieldInfo
import com.pagio.engine.PdfEditor
import com.pagio.engine.outputFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Remplissage des formulaires PDF (champs texte, cases, boutons radio, listes). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FormsScreen(onBack: () -> Unit, onOpen: (File) -> Unit, onContinue: (Tool) -> Unit, onEdit: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as Application
    val vm: ToolViewModel = viewModel(key = "forms") { ToolViewModel(app, Tool.FILL_FORMS) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> vm.addUris(listOf(u)) } }
    val file = vm.files.firstOrNull()
    var fields by remember { mutableStateOf<List<FormFieldInfo>?>(null) }
    val values = remember { mutableStateMapOf<String, String>() }
    var flatten by remember { mutableStateOf(false) }

    LaunchedEffect(file?.file, file?.password) {
        val f = file ?: return@LaunchedEffect
        fields = withContext(Dispatchers.IO) { runCatching { PdfEditor.listFields(f.file, f.password) }.getOrDefault(emptyList()) }
        values.clear(); fields?.forEach { values[it.name] = it.value }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.t_fill_forms)) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) } }) },
        bottomBar = {
            if (!fields.isNullOrEmpty() && vm.state !is TaskState.Done) Surface(tonalElevation = 3.dp, modifier = Modifier.navigationBarsPadding()) {
                Button(onClick = {
                    val f = file!!; val v = values.toMap(); val fl = flatten
                    vm.run { _ ->
                        withContext(Dispatchers.IO) {
                            val out = outputFile(context.container.workspace.newOutputDir(), f.displayName.substringBeforeLast('.') + "_rempli", "pdf")
                            PdfEditor.fillFields(f.file, v, fl, out, f.password)
                            ToolResult(Tool.FILL_FORMS, listOf(out), "${v.count { it.value.isNotBlank() }} champ(s) rempli(s)" + if (fl) " · formulaire figé" else "")
                        }
                    }
                }, modifier = Modifier.fillMaxWidth().padding(16.dp).height(52.dp)) { Text(stringResource(R.string.save)) }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            val st = vm.state
            when {
                st is TaskState.Done -> Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState())) {
                    ResultPanel(st.result, onOpen, { context.startActivity(context.container.workspace.shareIntent(st.result.outputs)) }, { vm.saveAll { } },
                        { f -> runCatching { context.startActivity(context.container.workspace.openWithIntent(f)) } }, { t -> Handoff.files = vm.outputsAsInputs(); onContinue(t) }, { vm.reset() })
                }
                file == null -> EmptyState(Icons.Outlined.UploadFile, stringResource(R.string.pick_file), stringResource(R.string.forms_empty)) {
                    Button(onClick = { picker.launch(arrayOf("application/pdf")) }) { Text(stringResource(R.string.pick_file)) }
                }
                fields?.isEmpty() == true -> Column(Modifier.padding(16.dp)) {
                    InfoCard(stringResource(R.string.no_form_fields))
                    Button(onClick = { Handoff.files = listOf(file); onEdit() }, modifier = Modifier.padding(top = 12.dp)) { Text(stringResource(R.string.add_fields_editor)) }
                }
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (st is TaskState.Failed) ErrorCard(st.message)
                    Text(stringResource(R.string.form_fields_count, fields?.size ?: 0), style = MaterialTheme.typography.titleMedium)
                    fields?.forEach { f -> FieldEditor(f, values[f.name] ?: "") { values[f.name] = it } }
                    SwitchRow(stringResource(R.string.flatten), flatten, { flatten = it }, stringResource(R.string.flatten_d))
                }
            }
        }
    }
    (vm.state as? TaskState.Running)?.let { ProgressDialog(stringResource(R.string.t_fill_forms), it.progress, it.message) { vm.cancel() } }
    vm.passwordFor?.let { f -> PasswordDialog(f.displayName, vm.passwordError, vm::submitPassword, vm::dismissPassword) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FieldEditor(f: FormFieldInfo, value: String, onChange: (String) -> Unit) {
    val label = f.name.substringAfterLast('.')
    when (f.type) {
        "checkbox" -> Card { SwitchRow(label, value == "true", { onChange(if (it) "true" else "false") }) }
        "radio", "choice" -> if (f.options.isNotEmpty()) {
            var open by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(open, { open = it }) {
                OutlinedTextField(value, {}, readOnly = true, label = { Text(label) }, trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
                    modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable))
                ExposedDropdownMenu(open, { open = false }) {
                    f.options.forEach { opt -> DropdownMenuItem(text = { Text(opt) }, onClick = { onChange(opt); open = false }) }
                }
            }
        } else OutlinedTextField(value, onChange, label = { Text(label) }, modifier = Modifier.fillMaxWidth())
        else -> OutlinedTextField(value, onChange, label = { Text(label) }, enabled = !f.readOnly, modifier = Modifier.fillMaxWidth())
    }
}
