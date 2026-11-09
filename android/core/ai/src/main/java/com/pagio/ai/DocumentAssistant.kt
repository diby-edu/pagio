package com.pagio.ai

/** Résultat d'une tâche : texte affiché + origine (IA générative ou analyse hors ligne). */
data class AssistantResult(val text: String, val usedProvider: String?, val offline: Boolean, val note: String? = null)

enum class AssistantTask(val label: String, val needsGenerative: Boolean) {
    SUMMARY("Résumé", false),
    KEY_INFO("Informations clés", false),
    INVOICE("Extraire une facture", false),
    CLASSIFY("Type de document", false),
    QUESTIONS("Questions de révision", false),
    TRANSLATE("Traduire", false),
    REPHRASE("Reformuler un passage", true),
    TABLES("Tableaux", false),
}

/**
 * Assistant documentaire. Utilise le fournisseur d'IA configuré quand il existe, sinon
 * les analyses hors ligne. Le texte du document est découpé pour respecter la taille de contexte.
 */
class DocumentAssistant(private val provider: AiProvider?) {

    val hasGenerative: Boolean get() = provider != null

    private val system = """
        Tu es l'assistant documentaire de l'application Pagio. Tu réponds en français clair et concis,
        sauf si l'utilisateur demande une autre langue. Tu t'appuies UNIQUEMENT sur le document fourni ;
        si l'information n'y figure pas, tu le dis franchement. Tu cites les numéros de page quand ils sont indiqués
        (balises [Page N]). Mise en forme simple : titres courts, listes à puces, pas de tableaux HTML.
    """.trimIndent()

    /** Ramène le document à une taille raisonnable en gardant début, milieu et fin. */
    fun fit(text: String, maxChars: Int = 60_000): String {
        if (text.length <= maxChars) return text
        val part = maxChars / 3
        val mid = text.length / 2
        return text.take(part) + "\n[…]\n" + text.substring(mid - part / 2, mid + part / 2) + "\n[…]\n" + text.takeLast(part)
    }

    suspend fun summarize(doc: String, detail: String = "standard"): AssistantResult {
        if (provider == null) {
            val sents = OfflineAnalysis.summarize(doc, if (detail == "court") 4 else 7)
            if (sents.isEmpty()) throw AiException("Le document ne contient pas assez de texte à résumer.")
            val kw = OfflineAnalysis.keywords(doc, 8)
            return AssistantResult("• " + sents.joinToString("\n• ") + "\n\nMots-clés : " + kw.joinToString(", "), null, true,
                "Résumé extractif hors ligne (phrases clés du document). Configurez un fournisseur d'IA pour un résumé rédigé.")
        }
        val prompt = when (detail) {
            "court" -> "Fais un résumé en 3 à 5 puces du document ci-dessous."
            "détaillé" -> "Fais un résumé détaillé et structuré (sections avec titres) du document ci-dessous, puis une conclusion en 2 phrases."
            else -> "Résume le document ci-dessous : une phrase d'introduction, puis 5 à 8 puces avec les points essentiels, puis les actions ou échéances éventuelles."
        }
        return gen("$prompt\n\n<document>\n${fit(doc)}\n</document>")
    }

    suspend fun chat(doc: String, history: List<ChatMessage>, question: String): AssistantResult {
        val p = provider ?: throw AiException("La conversation avec un document nécessite un fournisseur d'IA. Configurez-en un dans Réglages > Intelligence artificielle, ou connectez-vous au serveur Pagio.")
        val messages = mutableListOf(ChatMessage("user", "Voici le document sur lequel portent mes questions :\n<document>\n${fit(doc)}\n</document>"),
            ChatMessage("assistant", "J'ai lu le document. Quelle est votre question ?"))
        messages += history.takeLast(12)
        messages += ChatMessage("user", question)
        return AssistantResult(p.complete(system, messages), p.name, false)
    }

    suspend fun keyInfo(doc: String): AssistantResult {
        if (provider == null) {
            val k = OfflineAnalysis.keyInfo(doc)
            val sb = StringBuilder()
            fun add(label: String, v: List<String>) { if (v.isNotEmpty()) sb.append("$label : ").append(v.joinToString(" · ")).append("\n") }
            add("Dates", k.dates); add("Montants", k.amounts); add("E-mails", k.emails); add("Téléphones", k.phones)
            add("IBAN", k.ibans); add("Identifiants entreprise", k.sirets); add("N° TVA", k.vatNumbers); add("Liens", k.urls); add("Références", k.references)
            return AssistantResult(sb.toString().ifBlank { "Aucune information structurée détectée." }, null, true, "Extraction hors ligne par motifs (dates, montants, IBAN vérifiés…).")
        }
        return gen("Extrais les informations importantes du document : parties concernées, dates et échéances, montants, obligations, références et coordonnées. Présente-les sous forme de liste par catégorie.\n\n<document>\n${fit(doc)}\n</document>")
    }

    suspend fun invoice(doc: String): AssistantResult {
        val offline = OfflineAnalysis.invoice(doc)
        if (provider == null) {
            return AssistantResult(offline.asRows().joinToString("\n") { "${it.first} : ${it.second}" }, null, true,
                "Extraction hors ligne : vérifiez les montants. Un fournisseur d'IA améliore la précision sur les factures complexes.")
        }
        return gen("Extrais les données de cette facture au format « Champ : valeur », une ligne par champ : Numéro, Date, Échéance, Émetteur, Adresse émetteur, Client, Total HT, TVA (taux et montant), Total TTC, Devise, IBAN, N° TVA, Lignes de produits (désignation, quantité, prix). Mets « — » si absent.\n\n<document>\n${fit(doc, 30_000)}\n</document>")
    }

    suspend fun classify(doc: String): AssistantResult {
        val c = OfflineAnalysis.classify(doc)
        if (provider == null) {
            return AssistantResult("Type probable : ${c.type} (confiance ${(c.confidence * 100).toInt()} %)\nIndices : ${c.hints.joinToString(", ").ifBlank { "—" }}",
                null, true, "Reconnaissance hors ligne par mots-clés.")
        }
        return gen("Identifie le type de ce document administratif (facture, devis, bulletin de paie, avis d'imposition, contrat, relevé bancaire, attestation, pièce d'identité, courrier, etc.), l'organisme émetteur, la personne concernée, la date, et ce que le destinataire doit éventuellement faire. Réponds en 5 lignes maximum.\n\n<document>\n${fit(doc, 20_000)}\n</document>")
    }

    suspend fun questions(doc: String, count: Int = 8): AssistantResult {
        if (provider == null) {
            val qs = OfflineAnalysis.clozeQuestions(doc, count)
            if (qs.isEmpty()) throw AiException("Pas assez de contenu pour générer des questions.")
            return AssistantResult(qs.mapIndexed { i, (q, a) -> "${i + 1}. $q\n   Réponse : $a" }.joinToString("\n\n"), null, true,
                "Questions « à trous » générées hors ligne.")
        }
        return gen("Génère $count questions de compréhension variées (QCM et questions ouvertes) sur ce document, avec la réponse attendue sous chaque question.\n\n<document>\n${fit(doc)}\n</document>")
    }

    suspend fun rephrase(passage: String, tone: String): AssistantResult {
        if (passage.isBlank()) throw AiException("Saisissez ou collez le passage à reformuler.")
        val p = provider ?: throw AiException("La reformulation nécessite un fournisseur d'IA (Réglages > Intelligence artificielle).")
        return AssistantResult(p.complete(system, listOf(ChatMessage("user", "Reformule ce passage avec un ton $tone, sans changer le sens. Donne uniquement le texte reformulé.\n\n$passage"))), p.name, false)
    }

    suspend fun translateGenerative(doc: String, targetLanguage: String): AssistantResult =
        gen("Traduis fidèlement le document suivant en $targetLanguage. Conserve la structure (titres, listes). Donne uniquement la traduction.\n\n<document>\n${fit(doc, 40_000)}\n</document>")

    private suspend fun gen(prompt: String): AssistantResult {
        val p = provider!!
        return AssistantResult(p.complete(system, listOf(ChatMessage("user", prompt))), p.name, false)
    }
}
