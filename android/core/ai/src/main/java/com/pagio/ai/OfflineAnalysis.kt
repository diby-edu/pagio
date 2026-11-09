package com.pagio.ai

import kotlin.math.ln
import kotlin.math.sqrt

/**
 * Analyses documentaires hors ligne, sans modèle génératif : rapides, gratuites et privées.
 * Elles servent de solution de repli quand aucun fournisseur d'IA n'est configuré.
 */
object OfflineAnalysis {

    private val stopwords = setOf(
        // français
        "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "et", "ou", "à", "a", "au", "aux", "en", "dans", "par", "pour",
        "sur", "avec", "sans", "sous", "ce", "cet", "cette", "ces", "qui", "que", "quoi", "dont", "où", "il", "elle", "ils", "elles",
        "on", "nous", "vous", "je", "tu", "se", "sa", "son", "ses", "leur", "leurs", "ne", "pas", "plus", "est", "sont", "été",
        "être", "avoir", "a", "ont", "fait", "comme", "mais", "si", "y", "notre", "votre", "nos", "vos", "tout", "tous", "aussi",
        // anglais
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "is", "are", "was", "were", "be", "been", "it",
        "this", "that", "these", "those", "as", "at", "from", "not", "we", "you", "they", "he", "she", "our", "your", "their", "will",
    )

    fun sentences(text: String): List<String> =
        text.replace(Regex("\\s+"), " ")
            .split(Regex("(?<=[.!?…])\\s+(?=[A-ZÀ-ÖØ-Ý0-9«\"])"))
            .map { it.trim() }
            .filter { it.length in 25..600 }

    private fun words(s: String): List<String> =
        Regex("[\\p{L}][\\p{L}'’-]{2,}").findAll(s.lowercase()).map { it.value.trim('\'', '’', '-') }
            .filter { it !in stopwords && it.length > 2 }.toList()

    /**
     * Résumé extractif (TextRank) : les phrases les plus « centrales » du document,
     * remises dans leur ordre d'origine.
     */
    fun summarize(text: String, maxSentences: Int = 6): List<String> {
        val sents = sentences(text).take(400)
        if (sents.size <= maxSentences) return sents
        val bags = sents.map { s -> words(s).groupingBy { it }.eachCount() }
        val df = HashMap<String, Int>()
        bags.forEach { b -> b.keys.forEach { df[it] = (df[it] ?: 0) + 1 } }
        val n = sents.size.toDouble()
        val vectors = bags.map { b -> b.mapValues { (w, tf) -> tf * ln(n / (1 + (df[w] ?: 0))) } }
        fun cos(a: Map<String, Double>, b: Map<String, Double>): Double {
            val dot = a.entries.sumOf { (k, v) -> v * (b[k] ?: 0.0) }
            val na = sqrt(a.values.sumOf { it * it }); val nb = sqrt(b.values.sumOf { it * it })
            return if (na == 0.0 || nb == 0.0) 0.0 else dot / (na * nb)
        }
        val sim = Array(sents.size) { i -> DoubleArray(sents.size) { j -> if (i == j) 0.0 else cos(vectors[i], vectors[j]) } }
        var score = DoubleArray(sents.size) { 1.0 }
        repeat(25) {
            score = DoubleArray(sents.size) { i ->
                0.15 + 0.85 * sents.indices.sumOf { j ->
                    val out = sim[j].sum(); if (out == 0.0) 0.0 else sim[j][i] / out * score[j]
                }
            }
        }
        // Léger bonus aux premières phrases (souvent l'introduction).
        val boosted = score.mapIndexed { i, s -> s * (1.0 + 0.3 / (1 + i / 5.0)) }
        return boosted.withIndex().sortedByDescending { it.value }.take(maxSentences).map { it.index }.sorted().map { sents[it] }
    }

    /** Mots-clés principaux (TF-IDF par phrase). */
    fun keywords(text: String, max: Int = 12): List<String> =
        words(text).groupingBy { it }.eachCount().entries.filter { it.key.length > 3 }
            .sortedByDescending { it.value }.take(max).map { it.key }

    // ------------------------------------------------------------------ Informations clés

    data class KeyInfo(
        val dates: List<String>, val amounts: List<String>, val emails: List<String>, val phones: List<String>,
        val ibans: List<String>, val sirets: List<String>, val vatNumbers: List<String>, val urls: List<String>,
        val references: List<String>,
    )

    private val dateRegex = Regex("\\b(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:er)? (?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december) \\d{4})\\b", RegexOption.IGNORE_CASE)
    private val amountRegex = Regex("(?:€|EUR|\\$|USD|XOF|XAF|FCFA|CFA|£|CHF|MAD)\\s?-?\\d{1,3}(?:[  .\\u202F]?\\d{3})*(?:[.,]\\d{1,2})?|-?\\d{1,3}(?:[  .\\u202F]?\\d{3})*(?:[.,]\\d{1,2})?\\s?(?:€|EUR|\\$|USD|XOF|XAF|FCFA|F CFA|CFA|£|CHF|MAD|DH)", RegexOption.IGNORE_CASE)
    private val emailRegex = Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")
    private val phoneRegex = Regex("(?:\\+\\d{1,3}[ .-]?)?(?:\\(0\\)[ .-]?)?\\d(?:[ .-]?\\d{2}){3,5}\\b")
    private val ibanRegex = Regex("\\b[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\\b")
    private val siretRegex = Regex("\\b(?:SIRET|SIREN|RCCM|NIF|ICE)\\s*:?\\s*([A-Z0-9 -]{6,24})", RegexOption.IGNORE_CASE)
    private val vatRegex = Regex("\\b(?:FR|BE|LU|DE|IT|ES)\\s?[0-9A-Z]{2}\\s?\\d{3}\\s?\\d{3}\\s?\\d{3}\\b")
    private val urlRegex = Regex("https?://[^\\s)>\\]]+|www\\.[^\\s)>\\]]+")
    private val refRegex = Regex("(?:n[°o]|num[ée]ro|r[ée]f(?:[ée]rence)?|facture|invoice)\\s*[:#]?\\s*([A-Z0-9][A-Z0-9/_-]{2,})", RegexOption.IGNORE_CASE)

    fun keyInfo(text: String): KeyInfo = KeyInfo(
        dates = dateRegex.findAll(text).map { it.value }.distinct().take(20).toList(),
        amounts = amountRegex.findAll(text).map { it.value.trim() }.distinct().take(30).toList(),
        emails = emailRegex.findAll(text).map { it.value }.distinct().toList(),
        phones = phoneRegex.findAll(text).map { it.value.trim() }.filter { it.count(Char::isDigit) in 8..15 }.distinct().take(10).toList(),
        ibans = ibanRegex.findAll(text).map { it.value }.filter { validIban(it) }.distinct().toList(),
        sirets = siretRegex.findAll(text).map { it.value.trim() }.distinct().toList(),
        vatNumbers = vatRegex.findAll(text).map { it.value }.distinct().toList(),
        urls = urlRegex.findAll(text).map { it.value.trimEnd('.', ',') }.distinct().toList(),
        references = refRegex.findAll(text).map { it.groupValues[1] }.distinct().take(10).toList(),
    )

    /** Contrôle ISO 13616 (modulo 97) : évite les faux IBAN. */
    fun validIban(raw: String): Boolean {
        val s = raw.replace(" ", "").uppercase()
        if (s.length !in 15..34) return false
        val moved = s.drop(4) + s.take(4)
        var rem = 0
        for (c in moved) {
            val v = if (c.isDigit()) c.toString() else (c - 'A' + 10).toString()
            for (d in v) rem = (rem * 10 + (d - '0')) % 97
        }
        return rem == 1
    }

    // ------------------------------------------------------------------ Factures

    data class Invoice(
        val number: String?, val date: String?, val dueDate: String?, val seller: String?,
        val totalExclTax: String?, val vat: String?, val totalInclTax: String?, val currency: String?,
        val iban: String?, val vatNumber: String?,
    ) {
        fun asRows(): List<Pair<String, String>> = listOf(
            "Numéro" to number, "Date" to date, "Échéance" to dueDate, "Émetteur" to seller,
            "Total HT" to totalExclTax, "TVA" to vat, "Total TTC" to totalInclTax, "Devise" to currency,
            "IBAN" to iban, "N° TVA" to vatNumber,
        ).map { it.first to (it.second ?: "—") }
    }

    private fun valueAfter(text: String, labels: String): String? =
        Regex("(?:$labels)[^\\n\\d€$]{0,30}((?:€|EUR|\\$)?\\s?-?\\d{1,3}(?:[  .\\u202F]?\\d{3})*(?:[.,]\\d{1,2})?\\s?(?:€|EUR|\\$|XOF|FCFA|CFA|MAD)?)", RegexOption.IGNORE_CASE)
            .findAll(text).lastOrNull()?.groupValues?.get(1)?.trim()?.takeIf { it.any(Char::isDigit) }

    fun invoice(text: String): Invoice {
        val info = keyInfo(text)
        val number = Regex("(?:facture|invoice|n°\\s*facture|num[ée]ro de facture)\\s*(?:n[°o]\\.?)?\\s*[:#]?\\s*([A-Z0-9][A-Z0-9/_-]{2,})", RegexOption.IGNORE_CASE)
            .find(text)?.groupValues?.get(1)
        val date = Regex("(?:date(?: de facture| d'émission)?|émise? le|invoice date)\\s*:?\\s*(${dateRegex.pattern})", RegexOption.IGNORE_CASE)
            .find(text)?.groupValues?.get(1) ?: info.dates.firstOrNull()
        val due = Regex("(?:échéance|date limite|due date|à payer avant le|payable (?:avant|le))\\s*:?\\s*(${dateRegex.pattern})", RegexOption.IGNORE_CASE)
            .find(text)?.groupValues?.get(1)
        val currency = when {
            Regex("FCFA|XOF|F CFA").containsMatchIn(text) -> "XOF/FCFA"
            text.contains("XAF") -> "XAF"
            text.contains("€") || text.contains("EUR") -> "EUR"
            text.contains("$") || text.contains("USD") -> "USD"
            text.contains("MAD") || text.contains(" DH") -> "MAD"
            else -> null
        }
        val seller = text.lines().map { it.trim() }.firstOrNull { it.length in 3..60 && it.any(Char::isLetter) && !it.contains("facture", true) }
        return Invoice(
            number = number, date = date, dueDate = due, seller = seller,
            totalExclTax = valueAfter(text, "total\\s*h\\.?t\\.?|montant\\s*h\\.?t\\.?|sous-total|subtotal|total excl"),
            vat = valueAfter(text, "t\\.?v\\.?a\\.?(?:\\s*\\d+[.,]?\\d*\\s*%)?|vat|tax"),
            totalInclTax = valueAfter(text, "total\\s*t\\.?t\\.?c\\.?|net à payer|montant\\s*t\\.?t\\.?c\\.?|total à payer|total due|amount due|total"),
            currency = currency, iban = info.ibans.firstOrNull(), vatNumber = info.vatNumbers.firstOrNull(),
        )
    }

    // ------------------------------------------------------------------ Type de document

    data class Classification(val type: String, val confidence: Float, val hints: List<String>)

    private val categories: Map<String, List<String>> = mapOf(
        "Facture" to listOf("facture", "invoice", "total ttc", "tva", "montant ht", "net à payer", "échéance"),
        "Devis" to listOf("devis", "quotation", "validité de l'offre", "bon pour accord", "proposition commerciale"),
        "Bulletin de paie" to listOf("bulletin de paie", "salaire brut", "net à payer avant impôt", "cotisations", "fiche de paie", "salaire net"),
        "Relevé bancaire" to listOf("relevé de compte", "solde", "débit", "crédit", "iban", "opérations", "bank statement"),
        "Avis d'imposition" to listOf("avis d'impôt", "avis d'imposition", "revenu fiscal de référence", "impôt sur le revenu", "direction générale des finances"),
        "Contrat" to listOf("contrat", "entre les soussignés", "article 1", "les parties", "résiliation", "durée du contrat", "agreement"),
        "Quittance de loyer" to listOf("quittance", "loyer", "bailleur", "locataire", "charges locatives"),
        "Attestation" to listOf("attestation", "certifie", "atteste", "fait pour servir et valoir ce que de droit"),
        "Ordonnance médicale" to listOf("ordonnance", "posologie", "comprimé", "docteur", "médecin", "pharmacie"),
        "Curriculum vitae" to listOf("expérience professionnelle", "formation", "compétences", "curriculum", "langues", "centres d'intérêt"),
        "Courrier administratif" to listOf("madame, monsieur", "objet :", "veuillez agréer", "préfecture", "mairie", "dossier n°", "référence"),
        "Pièce d'identité" to listOf("carte nationale d'identité", "passeport", "date de naissance", "lieu de naissance", "nationalité", "identity card"),
        "Rapport / étude" to listOf("introduction", "conclusion", "méthodologie", "résultats", "sommaire", "annexe"),
    )

    fun classify(text: String): Classification {
        val low = text.lowercase()
        val scores = categories.mapValues { (_, keys) -> keys.filter { low.contains(it) } }
        val best = scores.maxByOrNull { it.value.size }
        if (best == null || best.value.isEmpty()) return Classification("Document général", 0.2f, emptyList())
        val total = scores.values.sumOf { it.size }.coerceAtLeast(1)
        val conf = (best.value.size.toFloat() / categories.getValue(best.key).size * 0.6f + best.value.size.toFloat() / total * 0.4f).coerceIn(0.15f, 0.97f)
        return Classification(best.key, conf, best.value)
    }

    // ------------------------------------------------------------------ Questions

    /** Questions de révision « à trous » générées à partir des phrases clés (hors ligne). */
    fun clozeQuestions(text: String, max: Int = 8): List<Pair<String, String>> {
        val key = keywords(text, 40).toSet()
        return summarize(text, max * 2).mapNotNull { s ->
            val target = words(s).filter { it in key }.maxByOrNull { it.length } ?: return@mapNotNull null
            val q = s.replace(Regex("\\b${Regex.escape(target)}\\b", RegexOption.IGNORE_CASE), "_____")
            if (q == s) null else q to target
        }.take(max)
    }
}
