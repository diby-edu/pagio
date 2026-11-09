package com.pagio.app.data

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Fichier choisi par l'utilisateur, copié dans l'espace de travail privé de l'application. */
data class PickedFile(val file: File, val displayName: String, val size: Long, val mime: String?, var password: String? = null) {
    val isPdf: Boolean get() = mime == "application/pdf" || displayName.endsWith(".pdf", true)
    val isImage: Boolean get() = mime?.startsWith("image/") == true || displayName.substringAfterLast('.').lowercase() in setOf("jpg", "jpeg", "png", "webp", "heic", "bmp", "gif")
}

/**
 * Gestion des fichiers : copie sécurisée des entrées dans le cache privé, dossier de sortie,
 * nettoyage des fichiers temporaires, enregistrement dans Téléchargements et partage.
 */
class Workspace(private val context: Context) {
    /**
     * Copies de travail des fichiers choisis. Volontairement hors du « cache » : Android vide le cache
     * des applications quand le téléphone manque de place, ce qui ferait disparaître un fichier en cours
     * de traitement. Pagio nettoie lui-même ce dossier (fin d'outil, démarrage, Réglages).
     */
    val workRoot: File get() = File(context.filesDir, "work").apply { mkdirs() }
    val outputRoot: File get() = File(context.filesDir, "outputs").apply { mkdirs() }
    val signaturesDir: File get() = File(context.filesDir, "signatures").apply { mkdirs() }
    val certDir: File get() = File(context.filesDir, "certificates").apply { mkdirs() }

    fun newTaskDir(): File = File(workRoot, "t" + System.currentTimeMillis()).apply { mkdirs() }

    fun newOutputDir(): File {
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(Date())
        return File(outputRoot, stamp).apply { mkdirs() }
    }

    suspend fun import(uri: Uri, dir: File = newTaskDir()): PickedFile = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        var name = "document"
        var size = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
        val mime = resolver.getType(uri)
        if (!name.contains('.')) MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { name = "$name.$it" }
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        var target = File(dir, safe); var i = 2
        while (target.exists()) { target = File(dir, "${safe.substringBeforeLast('.')} ($i).${safe.substringAfterLast('.', "bin")}"); i++ }
        resolver.openInputStream(uri)?.use { input -> target.outputStream().use { input.copyTo(it, 256 * 1024) } }
            ?: throw IllegalStateException("Impossible de lire le fichier sélectionné")
        PickedFile(target, name, if (size > 0) size else target.length(), mime)
    }

    /** Supprime les fichiers temporaires de plus de [olderThanMs] (par défaut : tout). */
    fun cleanTemp(olderThanMs: Long = 0): Long {
        var freed = 0L
        val limit = System.currentTimeMillis() - olderThanMs
        workRoot.listFiles()?.forEach { dir ->
            if (dir.lastModified() <= limit) { freed += dir.walkBottomUp().filter { it.isFile }.sumOf { it.length() }; dir.deleteRecursively() }
        }
        context.cacheDir.listFiles()?.filter { it.isFile && it.lastModified() <= limit }?.forEach { freed += it.length(); it.delete() }
        return freed
    }

    fun usedBytes(): Pair<Long, Long> =
        outputRoot.walkBottomUp().filter { it.isFile }.sumOf { it.length() } to workRoot.walkBottomUp().filter { it.isFile }.sumOf { it.length() }

    fun uriFor(file: File): Uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)

    fun mimeOf(file: File): String = when (file.extension.lowercase()) {
        "pdf" -> "application/pdf"
        "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"
        "txt" -> "text/plain"; "csv" -> "text/csv"
        "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        "zip" -> "application/zip"
        else -> "application/octet-stream"
    }

    fun shareIntent(files: List<File>): Intent {
        val uris = ArrayList(files.map { uriFor(it) })
        val intent = if (uris.size == 1) Intent(Intent.ACTION_SEND).apply { putExtra(Intent.EXTRA_STREAM, uris[0]); type = mimeOf(files[0]) }
        else Intent(Intent.ACTION_SEND_MULTIPLE).apply { putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris); type = "*/*" }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Intent.createChooser(intent, null)
    }

    fun openWithIntent(file: File): Intent =
        Intent(Intent.ACTION_VIEW).setDataAndType(uriFor(file), mimeOf(file)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    /** Copie dans Téléchargements/Pagio (sans permission de stockage sur Android 10+). */
    suspend fun saveToDownloads(file: File): String = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeOf(file))
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Pagio")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Enregistrement impossible")
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            values.clear(); values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            @Suppress("DEPRECATION")
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Pagio").apply { mkdirs() }
            file.copyTo(File(dir, file.name), overwrite = true)
        }
        "Téléchargements/Pagio/${file.name}"
    }

    suspend fun saveTo(file: File, uri: Uri) = withContext(Dispatchers.IO) {
        context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
    }
}

fun Long.humanSize(): String = when {
    this < 1024 -> "$this o"
    this < 1024 * 1024 -> "%.1f Ko".format(Locale.FRANCE, this / 1024.0)
    this < 1024L * 1024 * 1024 -> "%.1f Mo".format(Locale.FRANCE, this / 1024.0 / 1024.0)
    else -> "%.2f Go".format(Locale.FRANCE, this / 1024.0 / 1024.0 / 1024.0)
}
