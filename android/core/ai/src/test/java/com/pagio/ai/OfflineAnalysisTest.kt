package com.pagio.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineAnalysisTest {
    private val invoice = """
        Atelier Lumière SARL
        12 rue des Fleurs, 75011 Paris
        FACTURE N° FA-2026-0142
        Date de facture : 03/11/2026
        Échéance : 03/12/2026
        Désignation        Qté     Prix unitaire     Total
        Conception logo     1       800,00 €          800,00 €
        Total HT : 1 250,00 €
        TVA 20 % : 250,00 €
        Total TTC : 1 500,00 €
        IBAN : FR76 3000 6000 0112 3456 7890 189
        N° TVA intracommunautaire : FR40 123 456 789
        contact@atelier-lumiere.fr — 01 23 45 67 89
    """.trimIndent()

    @Test fun invoiceFieldsAreExtracted() {
        val inv = OfflineAnalysis.invoice(invoice)
        assertEquals("FA-2026-0142", inv.number)
        assertEquals("03/11/2026", inv.date)
        assertEquals("03/12/2026", inv.dueDate)
        assertEquals("EUR", inv.currency)
        assertTrue(inv.totalInclTax!!.contains("1 500,00"))
        assertTrue(inv.totalExclTax!!.contains("1 250,00"))
        assertNotNull(inv.iban)
    }

    @Test fun ibanChecksumIsValidated() {
        assertTrue(OfflineAnalysis.validIban("FR76 3000 6000 0112 3456 7890 189"))
        assertFalse(OfflineAnalysis.validIban("FR76 3000 6000 0112 3456 7890 188"))
    }

    @Test fun keyInfoFindsContacts() {
        val k = OfflineAnalysis.keyInfo(invoice)
        assertTrue(k.emails.contains("contact@atelier-lumiere.fr"))
        assertTrue(k.dates.contains("03/11/2026"))
        assertTrue(k.amounts.isNotEmpty())
        assertTrue(k.vatNumbers.isNotEmpty())
    }

    @Test fun invoiceIsClassified() = assertEquals("Facture", OfflineAnalysis.classify(invoice).type)

    @Test fun payslipIsClassified() =
        assertEquals("Bulletin de paie", OfflineAnalysis.classify("BULLETIN DE PAIE — Salaire brut 2 500 € — cotisations salariales — net à payer avant impôt").type)

    @Test fun summaryKeepsOriginalOrderAndLength() {
        val text = (1..30).joinToString(" ") { i ->
            if (i % 5 == 0) "Le projet Pagio améliore la confidentialité des documents grâce au traitement local numéro $i."
            else "Cette phrase de remplissage numéro $i parle de météo, de cuisine et de voyages variés."
        }
        val s = OfflineAnalysis.summarize(text, 4)
        assertEquals(4, s.size)
        val idx = s.map { text.indexOf(it) }
        assertEquals(idx.sorted(), idx)
    }

    @Test fun clozeQuestionsHaveAnswers() {
        val text = (1..12).joinToString(" ") { "La photosynthèse transforme la lumière en énergie chimique dans les chloroplastes des plantes vertes, étape $it." }
        val q = OfflineAnalysis.clozeQuestions(text, 3)
        assertTrue(q.isNotEmpty())
        q.forEach { (question, answer) -> assertTrue(question.contains("_____")); assertTrue(answer.isNotBlank()) }
    }
}
