package com.pagio.app.ui.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** Enregistrement d'un scan en images : 1 page = un JPG nommé, plusieurs pages = un dossier « page 1.jpg »… */
class ScanSaveTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun pending(n: Int): File = tmp.newFolder().apply { (1..n).forEach { File(this, "%03d.jpg".format(it)).writeText("page $it") } }

    @Test fun onePageBecomesNamedJpg() {
        val out = tmp.newFolder("sortie")
        val dir = pending(1)
        val saved = saveScan(dir, out, "Facture EDF", asPdf = false)
        assertEquals(listOf("Facture EDF.jpg"), saved.map { it.name })
        assertEquals("page 1", saved[0].readText())
        assertFalse("le dossier d'attente est effacé", dir.exists())
    }

    @Test fun severalPagesGoInANamedFolderInOrder() {
        val out = tmp.newFolder("sortie")
        val saved = saveScan(pending(3), out, "Contrat", asPdf = false)
        assertEquals(listOf("page 1.jpg", "page 2.jpg", "page 3.jpg"), saved.map { it.name })
        assertTrue(saved.all { it.parentFile == File(out, "Contrat") })
        assertEquals(listOf("page 1", "page 2", "page 3"), saved.map { it.readText() })
    }

    @Test fun takenNamesGetANumberInsteadOfOverwriting() {
        val out = tmp.newFolder("sortie")
        saveScan(pending(1), out, "Reçu", asPdf = false)
        saveScan(pending(2), out, "Lot", asPdf = false)
        assertEquals("Reçu (2).jpg", saveScan(pending(1), out, "Reçu", asPdf = false).single().name)
        assertEquals("Lot (2)", saveScan(pending(2), out, "Lot", asPdf = false).first().parentFile!!.name)
    }

    @Test fun extensionTypedByTheUserIsRemoved() {
        assertEquals("Photo", cleanFileName("Photo.jpg", "x"))
        assertEquals("Doc", cleanFileName("Doc.PDF", "x"))
    }
}
