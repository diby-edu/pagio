package com.pagio.app.ui.scan

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import com.pagio.app.R
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Nom proposé par défaut, lisible par tous : « Scan 18-11-2026 14h05 ». */
fun defaultScanName(at: Date = Date()): String = "Scan " + SimpleDateFormat("dd-MM-yyyy HH'h'mm", Locale.FRANCE).format(at)

/** Nom de fichier sûr : sans caractères interdits par Android ou Windows, ni espaces superflus, 80 caractères au plus. */
fun cleanFileName(raw: String, fallback: String): String {
    val base = raw.trim().removeSuffix(".pdf").removeSuffix(".PDF")
        .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), " ")
        .replace(Regex("\\s+"), " ").trim().trimStart('.').take(80).trim()
    return base.ifEmpty { fallback }
}

/**
 * Renomme le PDF scanné avec le nom choisi, dans son propre dossier. Si un fichier porte déjà ce nom,
 * on ajoute « (2) », « (3) »… plutôt que de l'écraser. Renvoie le fichier final.
 */
fun renameScan(file: File, wanted: String): File {
    val base = cleanFileName(wanted, defaultScanName())
    var target = File(file.parentFile, "$base.pdf"); var i = 2
    while (target.exists() && target.absolutePath != file.absolutePath) { target = File(file.parentFile, "$base ($i).pdf"); i++ }
    return if (target.absolutePath == file.absolutePath || file.renameTo(target)) target else file
}

/** Fenêtre affichée après chaque scan validé : l'utilisateur nomme son document avant de l'enregistrer. */
@Composable
fun ScanNameDialog(pages: Int, onSave: (String) -> Unit) {
    val suggested = remember { defaultScanName() }
    // Le nom proposé est entièrement sélectionné : il suffit de taper pour le remplacer.
    var value by remember { mutableStateOf(TextFieldValue(suggested, TextRange(0, suggested.length))) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val save = { onSave(cleanFileName(value.text, suggested)) }
    AlertDialog(
        // Fermer la fenêtre (retour, appui à côté) enregistre quand même avec le nom affiché : rien n'est perdu.
        onDismissRequest = save,
        title = { Text(stringResource(R.string.scan_name_title)) },
        text = {
            Column {
                Text(
                    stringResource(R.string.scan_name_pages, pages), style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value, { value = it }, Modifier.focusRequester(focus),
                    label = { Text(stringResource(R.string.scan_name_label)) }, singleLine = true,
                    suffix = { Text(".pdf") },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { save() }),
                )
            }
        },
        confirmButton = { TextButton(onClick = save) { Text(stringResource(R.string.save)) } },
    )
}
