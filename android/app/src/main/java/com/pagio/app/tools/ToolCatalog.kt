package com.pagio.app.tools

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.automirrored.outlined.Notes
import androidx.compose.material.icons.automirrored.outlined.RotateRight
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BorderColor
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CallSplit
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Compress
import androidx.compose.material.icons.outlined.ContentCut
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FindReplace
import androidx.compose.material.icons.outlined.FormatListNumbered
import androidx.compose.material.icons.outlined.GridOn
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MergeType
import androidx.compose.material.icons.outlined.NoteAdd
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.ViewAgenda
import androidx.compose.material.icons.outlined.ViewModule
import androidx.compose.material.icons.outlined.WaterDrop
import androidx.compose.material.icons.outlined.CleaningServices
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.HideSource
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Plagiarism
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import com.pagio.app.R

enum class Category(@StringRes val title: Int, val color: Color) {
    ORGANIZE(R.string.cat_organize, Color(0xFF5B4BDB)),
    OPTIMIZE(R.string.cat_optimize, Color(0xFF14A37F)),
    TO_PDF(R.string.cat_to_pdf, Color(0xFFF59E0B)),
    FROM_PDF(R.string.cat_from_pdf, Color(0xFF2E90FA)),
    EDIT(R.string.cat_edit, Color(0xFFE5484D)),
    SECURITY(R.string.cat_security, Color(0xFF334155)),
    AI(R.string.cat_ai, Color(0xFF9B51E0)),
}

/** Type de fichiers attendus en entrée. */
enum class InputKind(val mimes: Array<String>) {
    PDF(arrayOf("application/pdf")),
    IMAGES(arrayOf("image/*")),
    OFFICE(arrayOf(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.ms-powerpoint",
        "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.presentation",
    )),
    HTML(arrayOf("text/html", "application/xhtml+xml")),
    TEXT(arrayOf("text/plain", "text/markdown", "text/csv")),
    DOCUMENT(arrayOf("application/pdf", "image/*", "text/plain")),
    NONE(emptyArray()),
}

/** Écran utilisé pour exécuter l'outil. */
enum class Screen { GENERIC, ORGANIZE, EDITOR, FORMS, ASSISTANT, SCANNER }

enum class Tool(
    val id: String,
    val category: Category,
    val icon: ImageVector,
    @StringRes val title: Int,
    @StringRes val desc: Int,
    val input: InputKind,
    val multiple: Boolean = false,
    val minFiles: Int = 1,
    val screen: Screen = Screen.GENERIC,
    val isNew: Boolean = false,
) {
    // Organiser
    MERGE("merge", Category.ORGANIZE, Icons.Outlined.MergeType, R.string.t_merge, R.string.d_merge, InputKind.PDF, multiple = true, minFiles = 2),
    SPLIT("split", Category.ORGANIZE, Icons.Outlined.CallSplit, R.string.t_split, R.string.d_split, InputKind.PDF),
    ORGANIZE("organize", Category.ORGANIZE, Icons.Outlined.ViewModule, R.string.t_organize, R.string.d_organize, InputKind.PDF, screen = Screen.ORGANIZE),
    EXTRACT_PAGES("extract_pages", Category.ORGANIZE, Icons.Outlined.ContentCut, R.string.t_extract_pages, R.string.d_extract_pages, InputKind.PDF),
    DELETE_PAGES("delete_pages", Category.ORGANIZE, Icons.Outlined.Delete, R.string.t_delete_pages, R.string.d_delete_pages, InputKind.PDF),
    ROTATE("rotate", Category.ORGANIZE, Icons.AutoMirrored.Outlined.RotateRight, R.string.t_rotate, R.string.d_rotate, InputKind.PDF, multiple = true),

    // Optimiser
    COMPRESS("compress", Category.OPTIMIZE, Icons.Outlined.Compress, R.string.t_compress, R.string.d_compress, InputKind.PDF, multiple = true),
    REPAIR("repair", Category.OPTIMIZE, Icons.Outlined.Build, R.string.t_repair, R.string.d_repair, InputKind.PDF, multiple = true),
    OCR("ocr", Category.OPTIMIZE, Icons.Outlined.Plagiarism, R.string.t_ocr, R.string.d_ocr, InputKind.PDF, isNew = true),
    EXTRACT_TEXT("extract_text", Category.OPTIMIZE, Icons.AutoMirrored.Outlined.Notes, R.string.t_extract_text, R.string.d_extract_text, InputKind.DOCUMENT),

    // Convertir en PDF
    SCAN("scan", Category.TO_PDF, Icons.Outlined.DocumentScanner, R.string.t_scan, R.string.d_scan, InputKind.NONE, screen = Screen.SCANNER),
    IMAGES_TO_PDF("images_to_pdf", Category.TO_PDF, Icons.Outlined.PhotoLibrary, R.string.t_images_to_pdf, R.string.d_images_to_pdf, InputKind.IMAGES, multiple = true),
    OFFICE_TO_PDF("office_to_pdf", Category.TO_PDF, Icons.Outlined.Description, R.string.t_office_to_pdf, R.string.d_office_to_pdf, InputKind.OFFICE, multiple = true),
    HTML_TO_PDF("html_to_pdf", Category.TO_PDF, Icons.Outlined.Code, R.string.t_html_to_pdf, R.string.d_html_to_pdf, InputKind.HTML, isNew = true),
    TXT_TO_PDF("txt_to_pdf", Category.TO_PDF, Icons.Outlined.TextFields, R.string.t_txt_to_pdf, R.string.d_txt_to_pdf, InputKind.TEXT, multiple = true, isNew = true),
    CREATE_PDF("create_pdf", Category.TO_PDF, Icons.Outlined.NoteAdd, R.string.t_create_pdf, R.string.d_create_pdf, InputKind.NONE),

    // Convertir depuis PDF
    PDF_TO_WORD("pdf_to_word", Category.FROM_PDF, Icons.Outlined.Description, R.string.t_pdf_to_word, R.string.d_pdf_to_word, InputKind.PDF),
    PDF_TO_EXCEL("pdf_to_excel", Category.FROM_PDF, Icons.Outlined.GridOn, R.string.t_pdf_to_excel, R.string.d_pdf_to_excel, InputKind.PDF),
    PDF_TO_PPT("pdf_to_ppt", Category.FROM_PDF, Icons.Outlined.Slideshow, R.string.t_pdf_to_ppt, R.string.d_pdf_to_ppt, InputKind.PDF),
    PDF_TO_IMAGES("pdf_to_images", Category.FROM_PDF, Icons.Outlined.Image, R.string.t_pdf_to_images, R.string.d_pdf_to_images, InputKind.PDF),
    EXTRACT_IMAGES("extract_images", Category.FROM_PDF, Icons.Outlined.Photo, R.string.t_extract_images, R.string.d_extract_images, InputKind.PDF),

    // Modifier
    EDIT("edit", Category.EDIT, Icons.Outlined.EditNote, R.string.t_edit, R.string.d_edit, InputKind.PDF, screen = Screen.EDITOR),
    SIGN("sign", Category.EDIT, Icons.Outlined.Draw, R.string.t_sign, R.string.d_sign, InputKind.PDF, screen = Screen.EDITOR),
    FILL_FORMS("fill_forms", Category.EDIT, Icons.Outlined.CheckBox, R.string.t_fill_forms, R.string.d_fill_forms, InputKind.PDF, screen = Screen.FORMS),
    PAGE_NUMBERS("page_numbers", Category.EDIT, Icons.Outlined.FormatListNumbered, R.string.t_page_numbers, R.string.d_page_numbers, InputKind.PDF, multiple = true),
    WATERMARK("watermark", Category.EDIT, Icons.Outlined.WaterDrop, R.string.t_watermark, R.string.d_watermark, InputKind.PDF, multiple = true),
    HEADER_FOOTER("header_footer", Category.EDIT, Icons.Outlined.ViewAgenda, R.string.t_header_footer, R.string.d_header_footer, InputKind.PDF, multiple = true, isNew = true),
    REPLACE_TEXT("replace_text", Category.EDIT, Icons.Outlined.FindReplace, R.string.t_replace_text, R.string.d_replace_text, InputKind.PDF),
    REDACT("redact", Category.EDIT, Icons.Outlined.HideSource, R.string.t_redact, R.string.d_redact, InputKind.PDF, isNew = true),

    // Sécurité
    PROTECT("protect", Category.SECURITY, Icons.Outlined.Lock, R.string.t_protect, R.string.d_protect, InputKind.PDF),
    UNLOCK("unlock", Category.SECURITY, Icons.Outlined.LockOpen, R.string.t_unlock, R.string.d_unlock, InputKind.PDF),
    METADATA("metadata", Category.SECURITY, Icons.Outlined.Info, R.string.t_metadata, R.string.d_metadata, InputKind.PDF),
    STRIP_METADATA("strip_metadata", Category.SECURITY, Icons.Outlined.CleaningServices, R.string.t_strip_metadata, R.string.d_strip_metadata, InputKind.PDF, multiple = true, isNew = true),
    DIGITAL_SIGN("digital_sign", Category.SECURITY, Icons.Outlined.Fingerprint, R.string.t_digital_sign, R.string.d_digital_sign, InputKind.PDF, isNew = true),
    VERIFY_SIGN("verify_sign", Category.SECURITY, Icons.Outlined.VerifiedUser, R.string.t_verify_sign, R.string.d_verify_sign, InputKind.PDF, isNew = true),

    // IA
    ASSISTANT("assistant", Category.AI, Icons.Outlined.AutoAwesome, R.string.t_assistant, R.string.d_assistant, InputKind.DOCUMENT, screen = Screen.ASSISTANT, isNew = true),
    TRANSLATE("translate", Category.AI, Icons.Outlined.Translate, R.string.t_translate, R.string.d_translate, InputKind.DOCUMENT, screen = Screen.ASSISTANT, isNew = true),
    INVOICE("invoice", Category.AI, Icons.Outlined.Receipt, R.string.t_invoice, R.string.d_invoice, InputKind.DOCUMENT, screen = Screen.ASSISTANT, isNew = true),
    TABLES("tables", Category.AI, Icons.Outlined.TableChart, R.string.t_tables, R.string.d_tables, InputKind.PDF, isNew = true),
    CLASSIFY("classify", Category.AI, Icons.Outlined.Layers, R.string.t_classify, R.string.d_classify, InputKind.DOCUMENT, screen = Screen.ASSISTANT, isNew = true),
    ;

    companion object {
        fun byId(id: String): Tool? = entries.firstOrNull { it.id == id }
        val generic: Icon get() = Icon
    }
    object Icon { val file = Icons.AutoMirrored.Outlined.InsertDriveFile; val brush = Icons.Outlined.BorderColor }
}
