package com.pagio.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PageRangesTest {
    @Test fun simpleList() = assertEquals(listOf(1..3, 5..5, 8..10), PageRanges.parse("1-3, 5, 8-", 10))
    @Test fun emptyMeansAll() = assertEquals(listOf(1..7), PageRanges.parse("", 7))
    @Test fun frenchWordAll() = assertEquals(listOf(1..4), PageRanges.parse("toutes", 4))
    @Test fun openStart() = assertEquals(listOf(1..4), PageRanges.parse("-4", 9))
    @Test fun dashesAndSemicolons() = assertEquals(listOf(2..3, 6..6), PageRanges.parse("2–3; 6", 6))
    @Test fun pagesDeduplicatedAndSorted() = assertEquals(listOf(1, 2, 3, 5), PageRanges.pages("3,1-2,2,5", 5))
    @Test fun fixedGroups() = assertEquals(listOf(1..3, 4..6, 7..7), PageRanges.fixed(3, 7))

    @Test fun outOfDocumentIsRefused() {
        val e = assertThrows(EngineException::class.java) { PageRanges.parse("2-12", 10) }
        assertEquals(EngineError.INVALID_RANGE, e.code)
    }

    @Test fun garbageIsRefused() {
        assertThrows(EngineException::class.java) { PageRanges.parse("abc", 10) }
        assertThrows(EngineException::class.java) { PageRanges.parse("5-2", 10) }
    }
}
