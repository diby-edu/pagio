package com.pagio.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File

data class HistoryEntry(
    val id: Long,
    val toolId: String,
    val title: String,
    val createdAt: Long,
    val success: Boolean,
    val inputs: List<String>,       // noms des fichiers d'entrée
    val outputs: List<File>,        // fichiers produits (dans l'espace privé de l'application)
    val message: String?,
    val durationMs: Long,
) {
    val existingOutputs: List<File> get() = outputs.filter { it.exists() }

    /** Scan de plusieurs pages enregistré en images : le dossier qui les contient (nommé par l'utilisateur), sinon null. */
    val scanFolder: File? get() = if (toolId == "scan" && outputs.size > 1) outputs.mapNotNull { it.parentFile }.distinct().singleOrNull() else null
}

/** Historique des opérations (base SQLite locale, aucune donnée envoyée). */
class HistoryDb(context: Context) : SQLiteOpenHelper(context, "pagio.db", null, 1) {

    private val _entries = MutableStateFlow<List<HistoryEntry>>(emptyList())
    val entries: StateFlow<List<HistoryEntry>> = _entries

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL,
                success INTEGER NOT NULL, inputs TEXT NOT NULL, outputs TEXT NOT NULL,
                message TEXT, duration INTEGER NOT NULL DEFAULT 0)"""
        )
        db.execSQL("CREATE INDEX idx_history_created ON history(created DESC)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    suspend fun refresh() = withContext(Dispatchers.IO) {
        val list = mutableListOf<HistoryEntry>()
        readableDatabase.rawQuery("SELECT id, tool, title, created, success, inputs, outputs, message, duration FROM history ORDER BY created DESC LIMIT 300", null).use { c ->
            while (c.moveToNext()) {
                list += HistoryEntry(
                    c.getLong(0), c.getString(1), c.getString(2), c.getLong(3), c.getInt(4) == 1,
                    JSONArray(c.getString(5)).let { a -> (0 until a.length()).map { a.getString(it) } },
                    JSONArray(c.getString(6)).let { a -> (0 until a.length()).map { File(a.getString(it)) } },
                    if (c.isNull(7)) null else c.getString(7), c.getLong(8),
                )
            }
        }
        _entries.value = list
    }

    suspend fun add(toolId: String, title: String, success: Boolean, inputs: List<String>, outputs: List<File>, message: String?, durationMs: Long): Long =
        withContext(Dispatchers.IO) {
            val id = writableDatabase.insert("history", null, ContentValues().apply {
                put("tool", toolId); put("title", title); put("created", System.currentTimeMillis())
                put("success", if (success) 1 else 0)
                put("inputs", JSONArray(inputs).toString())
                put("outputs", JSONArray(outputs.map { it.absolutePath }).toString())
                put("message", message); put("duration", durationMs)
            })
            refresh(); id
        }

    /**
     * Renomme un fichier produit (même dossier, même extension) et met l'historique à jour.
     * Si le nom est déjà pris, « (2) », « (3) »… sont ajoutés. Renvoie le nouveau fichier, ou null en cas d'échec.
     */
    suspend fun renameOutput(id: Long, file: File, newBase: String): File? = withContext(Dispatchers.IO) {
        val entry = _entries.value.firstOrNull { it.id == id } ?: return@withContext null
        val ext = file.extension.let { if (it.isEmpty()) "" else ".$it" }
        var target = File(file.parentFile, newBase + ext); var i = 2
        while (target.exists() && target.absolutePath != file.absolutePath) { target = File(file.parentFile, "$newBase ($i)$ext"); i++ }
        if (target.absolutePath != file.absolutePath && !file.renameTo(target)) return@withContext null
        val outputs = entry.outputs.map { if (it.absolutePath == file.absolutePath) target else it }
        writableDatabase.update("history", ContentValues().apply {
            put("outputs", JSONArray(outputs.map { it.absolutePath }).toString())
            if (entry.outputs.size == 1) put("title", target.name)
        }, "id = ?", arrayOf(id.toString()))
        refresh(); target
    }

    /**
     * Renomme le dossier d'un scan enregistré en images (plusieurs pages) et met l'historique à jour.
     * « (2) », « (3) »… si le nom est pris. Renvoie le nouveau dossier, ou null en cas d'échec.
     */
    suspend fun renameFolder(id: Long, folder: File, newBase: String): File? = withContext(Dispatchers.IO) {
        val entry = _entries.value.firstOrNull { it.id == id } ?: return@withContext null
        val parent = folder.parentFile ?: return@withContext null
        var target = File(parent, newBase); var i = 2
        while (target.exists() && target.absolutePath != folder.absolutePath) { target = File(parent, "$newBase ($i)"); i++ }
        if (target.absolutePath != folder.absolutePath && !folder.renameTo(target)) return@withContext null
        val outputs = entry.outputs.map { if (it.parentFile?.absolutePath == folder.absolutePath) File(target, it.name) else it }
        writableDatabase.update("history", ContentValues().apply {
            put("outputs", JSONArray(outputs.map { it.absolutePath }).toString()); put("title", target.name)
        }, "id = ?", arrayOf(id.toString()))
        refresh(); target
    }

    /** Supprime les fichiers, puis leur dossier s'il est resté vide (dossier d'un scan en images). */
    private fun deleteOutputs(files: List<File>) {
        files.forEach { it.delete() }
        files.mapNotNull { it.parentFile }.distinct().forEach { d -> if (d.listFiles()?.isEmpty() == true) d.delete() }
    }

    suspend fun delete(id: Long, deleteFiles: Boolean) = withContext(Dispatchers.IO) {
        if (deleteFiles) _entries.value.firstOrNull { it.id == id }?.outputs?.let { deleteOutputs(it) }
        writableDatabase.delete("history", "id = ?", arrayOf(id.toString()))
        refresh()
    }

    suspend fun clear(deleteFiles: Boolean) = withContext(Dispatchers.IO) {
        if (deleteFiles) deleteOutputs(_entries.value.flatMap { it.outputs })
        writableDatabase.delete("history", null, null)
        refresh()
    }
}
