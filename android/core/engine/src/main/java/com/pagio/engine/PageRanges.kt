package com.pagio.engine

/**
 * Analyse des intervalles de pages saisis par l'utilisateur, numérotés à partir de 1.
 * Formats acceptés : "1-3, 5, 8-" (8 jusqu'à la fin), "-4" (début à 4), "all"/"tout".
 * Espaces, points-virgules et tirets longs sont tolérés.
 */
object PageRanges {

    fun parse(input: String, pageCount: Int): List<IntRange> {
        if (pageCount <= 0) throw EngineException(EngineError.EMPTY_INPUT, "Document vide")
        val text = input.trim().lowercase()
            .replace('–', '-').replace('—', '-').replace(';', ',')
        if (text.isEmpty() || text == "all" || text == "tout" || text == "toutes") {
            return listOf(1..pageCount)
        }
        val result = mutableListOf<IntRange>()
        for (raw in text.split(',')) {
            val part = raw.trim()
            if (part.isEmpty()) continue
            val range = if (part.contains('-')) {
                val (a, b) = part.split('-', limit = 2).map { it.trim() }
                val start = if (a.isEmpty()) 1 else a.toIntOrNull()
                val end = if (b.isEmpty()) pageCount else b.toIntOrNull()
                if (start == null || end == null) invalid(part)
                start..end
            } else {
                val n = part.toIntOrNull() ?: invalid(part)
                n..n
            }
            if (range.first < 1 || range.last > pageCount || range.first > range.last) {
                throw EngineException(
                    EngineError.INVALID_RANGE,
                    "L'intervalle « $part » sort du document (1 à $pageCount)"
                )
            }
            result += range
        }
        if (result.isEmpty()) invalid(input)
        return result
    }

    /** Ensemble trié des pages (1-based) couvertes par les intervalles. */
    fun pages(input: String, pageCount: Int): List<Int> =
        parse(input, pageCount).flatMap { it.toList() }.distinct().sorted()

    /** Découpe en groupes fixes de [size] pages : 1-3, 4-6, ... */
    fun fixed(size: Int, pageCount: Int): List<IntRange> {
        require(size >= 1) { "Taille de groupe invalide" }
        return (1..pageCount step size).map { it..minOf(it + size - 1, pageCount) }
    }

    private fun invalid(part: String): Nothing =
        throw EngineException(EngineError.INVALID_RANGE, "Intervalle illisible : « $part »")
}
