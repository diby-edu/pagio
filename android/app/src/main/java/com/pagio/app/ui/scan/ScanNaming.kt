package com.pagio.app.ui.scan

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.pagio.app.R
import com.pagio.engine.ImagePdfOptions
import com.pagio.engine.PdfCreate
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Nom proposé par défaut, lisible par tous : « Scan 18-11-2026 14h05 ». */
fun defaultScanName(at: Date = Date()): String = "Scan " + SimpleDateFormat("dd-MM-yyyy HH'h'mm", Locale.FRANCE).format(at)

/** Nom de fichier sûr : sans caractères interdits par Android ou Windows, ni espaces superflus, 80 caractères au plus. */
fun cleanFileName(raw: String, fallback: String): String {
    val base = raw.trim().replace(Regex("\\.(pdf|jpe?g)$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), " ")
        .replace(Regex("\\s+"), " ").trim().trimStart('.').take(80).trim()
    return base.ifEmpty { fallback }
}

/** Premier nom libre dans [dir] : « Nom.ext », sinon « Nom (2).ext », « Nom (3).ext »… (sans ext : un dossier). */
private fun freeName(dir: File, base: String, ext: String): File {
    val suffix = if (ext.isEmpty()) "" else ".$ext"
    var target = File(dir, base + suffix); var i = 2
    while (target.exists()) { target = File(dir, "$base ($i)$suffix"); i++ }
    return target
}

/**
 * Enregistre un scan dont les pages (JPG, dans l'ordre de leur nom) attendent dans [pagesDir], puis efface ce dossier.
 * - en PDF : un seul fichier « Nom.pdf » ;
 * - en images, 1 page : « Nom.jpg » ;
 * - en images, plusieurs pages : un dossier « Nom » contenant « page 1.jpg », « page 2.jpg »…
 * Un nom déjà pris reçoit « (2) », « (3) »… plutôt que d'écraser. Renvoie les fichiers enregistrés (pour Fichiers).
 */
fun saveScan(pagesDir: File, outputDir: File, wanted: String, asPdf: Boolean): List<File> {
    val base = cleanFileName(wanted, defaultScanName())
    val pages = pagesDir.listFiles { f -> f.isFile && f.extension.lowercase() in setOf("jpg", "jpeg") }?.sortedBy { it.name }.orEmpty()
    require(pages.isNotEmpty()) { "Aucune page à enregistrer" }
    outputDir.mkdirs()
    val saved = when {
        asPdf -> listOf(PdfCreate.imagesToPdf(pages, ImagePdfOptions(), freeName(outputDir, base, "pdf")))
        pages.size == 1 -> listOf(freeName(outputDir, base, "jpg").also { pages[0].copyTo(it) })
        else -> {
            val folder = freeName(outputDir, base, "").apply { mkdirs() }
            pages.mapIndexed { i, p -> File(folder, "page ${i + 1}.jpg").also { p.copyTo(it) } }
        }
    }
    pagesDir.deleteRecursively()
    return saved
}

/**
 * Fenêtre affichée après chaque scan : nom du document et case « Enregistrer en PDF », décochée à chaque scan.
 * [pdfPremium] : le PDF est réservé au Premium (mention affichée) ; [pdfAllowed] : cet utilisateur peut le cocher.
 */
@Composable
fun ScanNameDialog(pages: Int, pdfPremium: Boolean, pdfAllowed: Boolean, onSave: (name: String, asPdf: Boolean) -> Unit) {
    val suggested = remember { defaultScanName() }
    // Le nom proposé est entièrement sélectionné : il suffit de taper pour le remplacer.
    var value by remember { mutableStateOf(TextFieldValue(suggested, TextRange(0, suggested.length))) }
    var asPdf by remember { mutableStateOf(false) }
    var refused by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val save = { onSave(cleanFileName(value.text, suggested), asPdf && pdfAllowed) }
    val toggle = { if (pdfAllowed) asPdf = !asPdf else refused = true }
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
                    label = { Text(stringResource(if (!asPdf && pages > 1) R.string.scan_folder_label else R.string.scan_name_label)) }, singleLine = true,
                    // Plusieurs pages en images : le nom est celui du dossier, sans extension.
                    suffix = { if (asPdf) Text(".pdf") else if (pages == 1) Text(".jpg") },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { save() }),
                )
                if (!asPdf && pages > 1) Text(
                    stringResource(R.string.scan_folder_hint, pages), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp),
                )
                Row(
                    Modifier.fillMaxWidth().padding(top = 8.dp).clickable(role = Role.Checkbox, onClick = toggle),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = asPdf, onCheckedChange = { toggle() })
                    Text(
                        stringResource(R.string.scan_save_pdf) + if (pdfPremium) " · Premium" else "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (pdfAllowed) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (refused) Text(
                    stringResource(R.string.scan_pdf_premium_only), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
        },
        confirmButton = { TextButton(onClick = save) { Text(stringResource(R.string.save)) } },
    )
}
