package com.pagio.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class EventQueueTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun gardeDansLOrdreEtNeRetireQueCeQuiEstEnvoye() {
        val f = tmp.newFile("q.jsonl")
        val q = EventQueue(f)
        repeat(5) { q.add(JSONObject().put("n", it)) }
        assertEquals(listOf(0, 1), q.peek(2).map { it.getInt("n") })
        q.drop(2)
        assertEquals(3, q.size())
        // Application relancée : une nouvelle instance retrouve les événements restants, dans l'ordre
        assertEquals(listOf(2, 3, 4), EventQueue(f).peek(10).map { it.getInt("n") })
        q.drop(3)
        assertEquals(0, q.size())
    }
}
