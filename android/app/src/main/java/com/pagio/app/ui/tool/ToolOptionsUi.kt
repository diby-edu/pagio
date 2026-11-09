package com.pagio.app.ui.tool

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.pagio.app.R
import com.pagio.app.ServerState
import com.pagio.app.container
import com.pagio.app.tools.Tool
import com.pagio.app.tools.ToolOptions
import com.pagio.app.ui.components.AnchorPicker
import com.pagio.app.ui.components.ChoiceChips
import com.pagio.app.ui.components.InfoCard
import com.pagio.app.ui.components.PasswordField
import com.pagio.app.ui.components.SectionTitle
import com.pagio.app.ui.components.SliderRow
import com.pagio.app.ui.components.SwitchRow
import com.pagio.engine.CompressionLevel
import com.pagio.engine.ImageFormat
import com.pagio.engine.Orientation
import com.pagio.engine.PageSize
import kotlinx.coroutines.launch

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, hint: String? = null, number: Boolean = false, lines: Int = 1) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) },
        supportingText = hint?.let { { Text(it) } }, singleLine = lines == 1, minLines = lines,
        keyboardOptions = if (number) KeyboardOptions(keyboardType = KeyboardType.Number) else KeyboardOptions.Default,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    )
}

@Composable
fun ToolOptionsUi(tool: Tool, vm: ToolViewModel) {
    val o = vm.options
    fun set(f: (ToolOptions) -> ToolOptions) { vm.options = f(vm.options) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val serverState by context.container.server.collectAsState()
    val config by context.container.config.collectAsState()

    val rangesHint = stringResource(R.string.ranges_hint)
    when (tool) {
        Tool.SPLIT -> {
            SectionTitle(stringResource(R.string.opt_split_mode))
            ChoiceChips(listOf("ranges" to stringResource(R.string.split_ranges), "fixed" to stringResource(R.string.split_fixed),
                "every" to stringResource(R.string.split_every), "size" to stringResource(R.string.split_size)), o.splitMode, { m -> set { it.copy(splitMode = m) } })
            when (o.splitMode) {
                "ranges" -> {
                    Field(stringResource(R.string.ranges), o.ranges, { v -> set { it.copy(ranges = v) } }, rangesHint)
                    SwitchRow(stringResource(R.string.merge_ranges), o.mergeRanges, { v -> set { it.copy(mergeRanges = v) } })
                }
                "fixed" -> Field(stringResource(R.string.pages_per_file), o.fixedSize.toString(), { v -> set { it.copy(fixedSize = v.toIntOrNull() ?: 1) } }, number = true)
                "size" -> SliderRow(stringResource(R.string.max_size), o.maxSizeMb, 0.5f..50f, "%.1f Mo".format(o.maxSizeMb)) { v -> set { it.copy(maxSizeMb = v) } }
            }
        }
        Tool.EXTRACT_PAGES, Tool.DELETE_PAGES -> {
            SectionTitle(stringResource(R.string.pages))
            Field(stringResource(R.string.ranges), o.ranges, { v -> set { it.copy(ranges = v) } }, rangesHint)
        }
        Tool.ROTATE -> {
            SectionTitle(stringResource(R.string.opt_rotation))
            ChoiceChips(listOf(90 to "90° ↻", 180 to "180°", 270 to "90° ↺"), o.rotation, { v -> set { it.copy(rotation = v) } })
            Field(stringResource(R.string.pages_optional), o.ranges, { v -> set { it.copy(ranges = v) } }, stringResource(R.string.all_pages_if_empty))
        }
        Tool.COMPRESS -> {
            SectionTitle(stringResource(R.string.opt_compression))
            CompressionLevel.entries.forEach { level ->
                Card(onClick = { set { it.copy(compression = level) } }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    colors = androidx.compose.material3.CardDefaults.cardColors(containerColor = if (o.compression == level) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp)) {
                        Text(when (level) { CompressionLevel.LOW -> stringResource(R.string.compress_low); CompressionLevel.RECOMMENDED -> stringResource(R.string.compress_reco); CompressionLevel.EXTREME -> stringResource(R.string.compress_extreme) },
                            style = MaterialTheme.typography.titleSmall)
                        Text(when (level) { CompressionLevel.LOW -> stringResource(R.string.compress_low_d); CompressionLevel.RECOMMENDED -> stringResource(R.string.compress_reco_d); CompressionLevel.EXTREME -> stringResource(R.string.compress_extreme_d) },
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Tool.OCR -> {
            SectionTitle(stringResource(R.string.options))
            SwitchRow(stringResource(R.string.ocr_also_txt), o.ocrAlsoTxt, { v -> set { it.copy(ocrAlsoTxt = v) } })
            SwitchRow(stringResource(R.string.ocr_force), o.ocrForce, { v -> set { it.copy(ocrForce = v) } }, stringResource(R.string.ocr_force_d))
            InfoCard(stringResource(R.string.ocr_info))
        }
        Tool.IMAGES_TO_PDF -> {
            PageSizeOptions(o, ::set, allowFit = true)
            SectionTitle(stringResource(R.string.opt_margin))
            ChoiceChips(listOf(0f to stringResource(R.string.margin_none), 18f to stringResource(R.string.margin_small), 40f to stringResource(R.string.margin_large)), o.marginPt, { v -> set { it.copy(marginPt = v) } })
        }
        Tool.OFFICE_TO_PDF, Tool.PDF_TO_WORD -> {
            SectionTitle(stringResource(R.string.opt_quality))
            val serverOk = serverState == ServerState.ONLINE && config.serverConversion
            SwitchRow(stringResource(R.string.use_server), o.useServer && serverOk, { v -> set { it.copy(useServer = v) } },
                stringResource(if (serverOk) R.string.use_server_d else R.string.use_server_unavailable))
            InfoCard(stringResource(if (tool == Tool.OFFICE_TO_PDF) R.string.office_local_info else R.string.pdf_word_info))
        }
        Tool.HTML_TO_PDF -> {
            SectionTitle(stringResource(R.string.or_web_address))
            Field(stringResource(R.string.web_address), o.htmlUrl, { v -> set { it.copy(htmlUrl = v) } }, stringResource(R.string.web_address_hint))
        }
        Tool.TXT_TO_PDF -> {
            SectionTitle(stringResource(R.string.options))
            SliderRow(stringResource(R.string.font_size), o.textFontSize, 7f..20f, "${o.textFontSize.toInt()} pt", steps = 12) { v -> set { it.copy(textFontSize = v) } }
            SwitchRow(stringResource(R.string.monospace), o.monospace, { v -> set { it.copy(monospace = v) } })
        }
        Tool.CREATE_PDF -> {
            PageSizeOptions(o, ::set, allowFit = false)
            SectionTitle(stringResource(R.string.opt_pattern))
            ChoiceChips(listOf("blank" to stringResource(R.string.pattern_blank), "lines" to stringResource(R.string.pattern_lines), "grid" to stringResource(R.string.pattern_grid), "dots" to stringResource(R.string.pattern_dots)),
                o.blankPattern, { v -> set { it.copy(blankPattern = v) } })
            SectionTitle(stringResource(R.string.page_color))
            ChoiceChips(listOf("#FFFFFF" to stringResource(R.string.color_white), "#FFF8E1" to stringResource(R.string.color_cream), "#E8F0FE" to stringResource(R.string.color_blue), "#ECFDF3" to stringResource(R.string.color_green)),
                o.blankColor, { v -> set { it.copy(blankColor = v) } })
            SliderRow(stringResource(R.string.page_count), o.blankPages.toFloat(), 1f..50f, o.blankPages.toString()) { v -> set { it.copy(blankPages = v.toInt()) } }
        }
        Tool.PDF_TO_EXCEL -> {
            SectionTitle(stringResource(R.string.opt_layout))
            ChoiceChips(listOf(false to stringResource(R.string.one_sheet), true to stringResource(R.string.sheet_per_page)), o.sheetPerPage, { v -> set { it.copy(sheetPerPage = v) } })
            InfoCard(stringResource(R.string.pdf_excel_info))
        }
        Tool.PDF_TO_PPT -> {
            SectionTitle(stringResource(R.string.opt_layout))
            ChoiceChips(listOf(false to stringResource(R.string.ppt_image), true to stringResource(R.string.ppt_text)), o.pptEditable, { v -> set { it.copy(pptEditable = v) } })
        }
        Tool.PDF_TO_IMAGES, Tool.EXTRACT_IMAGES -> {
            SectionTitle(stringResource(R.string.opt_format))
            ChoiceChips(listOf(ImageFormat.JPG to "JPG", ImageFormat.PNG to "PNG"), o.imageFormat, { v -> set { it.copy(imageFormat = v) } })
            if (tool == Tool.PDF_TO_IMAGES) {
                SectionTitle(stringResource(R.string.opt_resolution))
                ChoiceChips(listOf(72 to "72 ppp", 150 to "150 ppp", 300 to "300 ppp"), o.dpi, { v -> set { it.copy(dpi = v) } })
                Field(stringResource(R.string.pages_optional), o.ranges, { v -> set { it.copy(ranges = v) } }, stringResource(R.string.all_pages_if_empty))
            }
        }
        Tool.PAGE_NUMBERS -> {
            SectionTitle(stringResource(R.string.opt_position))
            AnchorPicker(o.pnAnchor) { a -> set { it.copy(pnAnchor = a) } }
            SectionTitle(stringResource(R.string.opt_format))
            ChoiceChips(listOf("{n}" to "1", "Page {n}" to "Page 1", "{n} / {p}" to "1 / 10", "Page {n} sur {p}" to "Page 1 sur 10", "- {n} -" to "- 1 -"), o.pnFormat, { v -> set { it.copy(pnFormat = v) } })
            Field(stringResource(R.string.first_number), o.pnFirst.toString(), { v -> set { it.copy(pnFirst = v.toIntOrNull() ?: 1) } }, number = true)
            Field(stringResource(R.string.pages_optional), o.ranges, { v -> set { it.copy(ranges = v) } }, stringResource(R.string.all_pages_if_empty))
            SliderRow(stringResource(R.string.font_size), o.fontSize, 7f..24f, "${o.fontSize.toInt()} pt") { v -> set { it.copy(fontSize = v) } }
            SwitchRow(stringResource(R.string.facing_pages), o.pnFacing, { v -> set { it.copy(pnFacing = v) } }, stringResource(R.string.facing_pages_d))
        }
        Tool.WATERMARK -> {
            SectionTitle(stringResource(R.string.wm_content))
            Field(stringResource(R.string.wm_text), o.wmText, { v -> set { it.copy(wmText = v) } })
            val imgPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
                uri?.let { scope.launch { val f = context.container.workspace.import(it); vm.options = vm.options.copy(wmImage = f) } }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = { imgPicker.launch("image/*") }) { Text(stringResource(if (o.wmImage == null) R.string.wm_add_image else R.string.wm_change_image)) }
                Spacer(Modifier.width(8.dp))
                o.wmImage?.let { Text(it.displayName, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f)) }
                if (o.wmImage != null) OutlinedButton(onClick = { set { it.copy(wmImage = null) } }) { Text(stringResource(R.string.remove)) }
            }
            SectionTitle(stringResource(R.string.opt_position))
            SwitchRow(stringResource(R.string.wm_mosaic), o.wmMosaic, { v -> set { it.copy(wmMosaic = v) } })
            if (!o.wmMosaic) AnchorPicker(o.wmAnchor) { a -> set { it.copy(wmAnchor = a) } }
            SectionTitle(stringResource(R.string.wm_style))
            SliderRow(stringResource(R.string.wm_opacity), o.wmOpacity, 0.05f..1f, "${(o.wmOpacity * 100).toInt()} %") { v -> set { it.copy(wmOpacity = v) } }
            SliderRow(stringResource(R.string.wm_rotation), o.wmRotation, -90f..90f, "${o.wmRotation.toInt()}°") { v -> set { it.copy(wmRotation = v) } }
            SliderRow(stringResource(R.string.font_size), o.wmSize, 12f..120f, "${o.wmSize.toInt()} pt") { v -> set { it.copy(wmSize = v) } }
            ChoiceChips(listOf("#E5484D" to stringResource(R.string.color_red), "#5B4BDB" to stringResource(R.string.color_indigo), "#64748B" to stringResource(R.string.color_grey), "#111111" to stringResource(R.string.color_black)),
                o.wmColor, { v -> set { it.copy(wmColor = v) } })
            SwitchRow(stringResource(R.string.wm_behind), o.wmBehind, { v -> set { it.copy(wmBehind = v) } }, stringResource(R.string.wm_behind_d))
            Field(stringResource(R.string.pages_optional), o.ranges, { v -> set { it.copy(ranges = v) } }, stringResource(R.string.all_pages_if_empty))
        }
        Tool.HEADER_FOOTER -> {
            val hf = o.hf
            InfoCard(stringResource(R.string.hf_tokens))
            SectionTitle(stringResource(R.string.hf_header))
            Field(stringResource(R.string.left), hf.headerLeft, { v -> set { it.copy(hf = it.hf.copy(headerLeft = v)) } })
            Field(stringResource(R.string.center), hf.headerCenter, { v -> set { it.copy(hf = it.hf.copy(headerCenter = v)) } })
            Field(stringResource(R.string.right), hf.headerRight, { v -> set { it.copy(hf = it.hf.copy(headerRight = v)) } })
            SectionTitle(stringResource(R.string.hf_footer))
            Field(stringResource(R.string.left), hf.footerLeft, { v -> set { it.copy(hf = it.hf.copy(footerLeft = v)) } })
            Field(stringResource(R.string.center), hf.footerCenter, { v -> set { it.copy(hf = it.hf.copy(footerCenter = v)) } })
            Field(stringResource(R.string.right), hf.footerRight, { v -> set { it.copy(hf = it.hf.copy(footerRight = v)) } })
            SliderRow(stringResource(R.string.font_size), hf.fontSize, 6f..16f, "${hf.fontSize.toInt()} pt") { v -> set { it.copy(hf = it.hf.copy(fontSize = v)) } }
            Field(stringResource(R.string.pages_optional), o.ranges, { v -> set { it.copy(ranges = v) } }, stringResource(R.string.all_pages_if_empty))
        }
        Tool.REPLACE_TEXT -> {
            SectionTitle(stringResource(R.string.options))
            Field(stringResource(R.string.search_text), o.search, { v -> set { it.copy(search = v) } })
            Field(stringResource(R.string.replace_by), o.replacement, { v -> set { it.copy(replacement = v) } })
            InfoCard(stringResource(R.string.replace_info))
        }
        Tool.REDACT -> {
            SectionTitle(stringResource(R.string.redact_what))
            Field(stringResource(R.string.redact_terms), o.redactTerms, { v -> set { it.copy(redactTerms = v) } }, stringResource(R.string.redact_terms_hint), lines = 2)
            SwitchRow(stringResource(R.string.redact_emails), o.redactEmails, { v -> set { it.copy(redactEmails = v) } })
            SwitchRow(stringResource(R.string.redact_phones), o.redactPhones, { v -> set { it.copy(redactPhones = v) } })
            SwitchRow(stringResource(R.string.redact_ibans), o.redactIbans, { v -> set { it.copy(redactIbans = v) } })
            InfoCard(stringResource(R.string.redact_info))
        }
        Tool.PROTECT -> {
            SectionTitle(stringResource(R.string.password))
            PasswordField(o.password, { v -> set { it.copy(password = v) } }, stringResource(R.string.password))
            Spacer(Modifier.height(8.dp))
            PasswordField(o.passwordConfirm, { v -> set { it.copy(passwordConfirm = v) } }, stringResource(R.string.password_confirm))
            SectionTitle(stringResource(R.string.permissions))
            SwitchRow(stringResource(R.string.allow_print), o.allowPrint, { v -> set { it.copy(allowPrint = v) } })
            SwitchRow(stringResource(R.string.allow_copy), o.allowCopy, { v -> set { it.copy(allowCopy = v) } })
            SwitchRow(stringResource(R.string.allow_modify), o.allowModify, { v -> set { it.copy(allowModify = v) } })
            InfoCard(stringResource(R.string.protect_info))
        }
        Tool.UNLOCK -> {
            SectionTitle(stringResource(R.string.password))
            PasswordField(o.password, { v -> set { it.copy(password = v) } }, stringResource(R.string.current_password))
            InfoCard(stringResource(R.string.unlock_info))
        }
        Tool.METADATA -> {
            SectionTitle(stringResource(R.string.properties))
            Field(stringResource(R.string.meta_title), o.metaTitle, { v -> set { it.copy(metaTitle = v) } })
            Field(stringResource(R.string.meta_author), o.metaAuthor, { v -> set { it.copy(metaAuthor = v) } })
            Field(stringResource(R.string.meta_subject), o.metaSubject, { v -> set { it.copy(metaSubject = v) } })
            Field(stringResource(R.string.meta_keywords), o.metaKeywords, { v -> set { it.copy(metaKeywords = v) } })
        }
        Tool.STRIP_METADATA -> InfoCard(stringResource(R.string.strip_info))
        Tool.DIGITAL_SIGN -> {
            SectionTitle(stringResource(R.string.signature_details))
            Field(stringResource(R.string.signer_name), o.signerName, { v -> set { it.copy(signerName = v) } })
            Field(stringResource(R.string.sign_reason), o.signReason, { v -> set { it.copy(signReason = v) } })
            Field(stringResource(R.string.sign_location), o.signLocation, { v -> set { it.copy(signLocation = v) } })
            SectionTitle(stringResource(R.string.certificate))
            val certPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                uri?.let { scope.launch { vm.options = vm.options.copy(certificate = context.container.workspace.import(it)) } }
            }
            Text(o.certificate?.displayName ?: stringResource(R.string.cert_auto), style = MaterialTheme.typography.bodyMedium)
            Row {
                OutlinedButton(onClick = { certPicker.launch(arrayOf("application/x-pkcs12", "application/octet-stream", "*/*")) }) { Text(stringResource(R.string.cert_import)) }
                if (o.certificate != null) { Spacer(Modifier.width(8.dp)); OutlinedButton(onClick = { set { it.copy(certificate = null) } }) { Text(stringResource(R.string.cert_use_auto)) } }
            }
            if (o.certificate != null) PasswordField(o.certificatePassword, { v -> set { it.copy(certificatePassword = v) } }, stringResource(R.string.cert_password))
            InfoCard(stringResource(R.string.digital_sign_info))
        }
        Tool.VERIFY_SIGN -> InfoCard(stringResource(R.string.verify_info))
        Tool.TABLES -> InfoCard(stringResource(R.string.tables_info))
        Tool.MERGE -> InfoCard(stringResource(R.string.merge_info))
        Tool.REPAIR -> InfoCard(stringResource(R.string.repair_info))
        else -> Unit
    }
}

@Composable
private fun PageSizeOptions(o: ToolOptions, set: ((ToolOptions) -> ToolOptions) -> Unit, allowFit: Boolean) {
    SectionTitle(stringResource(R.string.opt_page_size))
    ChoiceChips(PageSize.entries.filter { allowFit || it != PageSize.FIT }.map { it to it.label }, o.pageSize, { v -> set { it.copy(pageSize = v) } })
    SectionTitle(stringResource(R.string.opt_orientation))
    ChoiceChips(listOfNotNull(if (allowFit) Orientation.AUTO to stringResource(R.string.orient_auto) else null,
        Orientation.PORTRAIT to stringResource(R.string.orient_portrait), Orientation.LANDSCAPE to stringResource(R.string.orient_landscape)), o.orientation, { v -> set { it.copy(orientation = v) } })
}
