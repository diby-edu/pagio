package com.pagio.engine.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class DocScanTest {
    private val w = 300; private val h = 400

    private fun rgb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    private fun inside(q: List<Pair<Float, Float>>, x: Float, y: Float): Boolean {
        var sign = 0
        for (i in 0 until 4) {
            val a = q[i]; val b = q[(i + 1) % 4]
            val cross = (b.first - a.first) * (y - a.second) - (b.second - a.second) * (x - a.first)
            val s = if (cross >= 0) 1 else -1
            if (sign == 0) sign = s else if (s != sign) return false
        }
        return true
    }

    /** Photo simulée : une feuille [paper] vue de biais sur un fond [table], avec des lignes de texte et du grain. */
    private fun photo(corners: List<Pair<Float, Float>>, table: Int, paper: Int, text: Boolean = true): IntArray {
        val rnd = java.util.Random(7)
        // Comme sur une vraie feuille, le texte ne va pas jusqu'au bord : il reste une marge blanche.
        val cx = corners.map { it.first }.average().toFloat(); val cy = corners.map { it.second }.average().toFloat()
        val printed = corners.map { (cx + (it.first - cx) * 0.82f) to (cy + (it.second - cy) * 0.82f) }
        return IntArray(w * h) { i ->
            val x = i % w; val y = i / w
            val base = if (inside(corners, x.toFloat(), y.toFloat())) {
                if (text && y % 14 in 0..2 && x % 90 > 12 && inside(printed, x.toFloat(), y.toFloat())) rgb(40, 40, 45) else paper
            } else table
            val n = rnd.nextInt(13) - 6
            rgb((((base shr 16) and 0xFF) + n).coerceIn(0, 255), (((base shr 8) and 0xFF) + n).coerceIn(0, 255), ((base and 0xFF) + n).coerceIn(0, 255))
        }
    }

    private fun assertCorners(expected: List<Pair<Float, Float>>, q: Quad, tolerancePx: Float = 6f) {
        q.corners.forEachIndexed { i, c ->
            val dx = abs(c.x * (w - 1) - expected[i].first); val dy = abs(c.y * (h - 1) - expected[i].second)
            assertTrue("coin $i trop loin : attendu ${expected[i]}, trouvé (${c.x * (w - 1)}, ${c.y * (h - 1)})", dx <= tolerancePx && dy <= tolerancePx)
        }
    }

    @Test fun whitePaperOnDarkTable() {
        val corners = listOf(60f to 50f, 250f to 70f, 265f to 350f, 40f to 330f)
        val q = DocScan.detect(photo(corners, rgb(60, 45, 35), rgb(235, 235, 230)), w, h)
        assertNotNull(q); assertCorners(corners, q!!)
    }

    @Test fun rotatedPaper() {
        val corners = listOf(110f to 40f, 270f to 130f, 190f to 360f, 30f to 270f)
        val q = DocScan.detect(photo(corners, rgb(30, 30, 30), rgb(240, 240, 240)), w, h)
        assertNotNull(q); assertCorners(corners, q!!)
    }

    /** Feuille colorée pas plus claire que le fond : seule la différence de couleur avec les bords la révèle. */
    @Test fun coloredPaperOnLightTable() {
        val corners = listOf(50f to 60f, 240f to 60f, 240f to 340f, 50f to 340f)
        val q = DocScan.detect(photo(corners, rgb(200, 200, 200), rgb(70, 110, 190), text = false), w, h)
        assertNotNull(q); assertCorners(corners, q!!)
    }

    @Test fun nothingToFindOnUniformImage() {
        assertNull(DocScan.detect(IntArray(w * h) { rgb(128, 128, 128) }, w, h))
    }

    @Test fun convexity() {
        assertTrue(Quad.FULL.isConvex)
        val crossed = Quad(Corner(0.1f, 0.1f), Corner(0.9f, 0.9f), Corner(0.9f, 0.1f), Corner(0.1f, 0.9f))
        assertTrue(!crossed.isConvex)
    }

    @Test fun outputSizeFollowsTheSidesAndTheLimit() {
        val q = Quad(Corner(0f, 0f), Corner(1f, 0f), Corner(1f, 1f), Corner(0f, 1f))
        assertEquals(3000 to 4000, DocScan.outputSize(q, 3000, 4000, 5000))
        assertEquals(1500 to 2000, DocScan.outputSize(q, 3000, 4000, 2000))
    }

    /** Papier éclairé de travers (ombre à droite) : le filtre noir et blanc doit rendre le papier blanc partout. */
    @Test fun blackWhiteRemovesShadow() {
        val px = IntArray(w * h) { i ->
            val x = i % w; val y = i / w
            val light = 230 - x * 110 / w
            if (y % 20 in 0..3 && x % 60 > 10) rgb(light / 5, light / 5, light / 5) else rgb(light, light, light)
        }
        DocScan.applyFilter(px, w, h, ScanFilter.BLACK_WHITE)
        fun v(x: Int, y: Int) = px[y * w + x] and 0xFF
        assertTrue("papier clair à gauche : ${v(20, 10)}", v(20, 10) > 235)
        assertTrue("papier clair dans l'ombre : ${v(w - 20, 10)}", v(w - 20, 10) > 235)
        assertTrue("encre sombre à gauche : ${v(30, 21)}", v(30, 21) < 60)
        assertTrue("encre sombre dans l'ombre : ${v(w - 30, 21)}", v(w - 30, 21) < 60)
    }

    @Test fun grayKeepsBrightness() {
        val px = intArrayOf(rgb(255, 0, 0), rgb(255, 255, 255))
        DocScan.applyFilter(px, 2, 1, ScanFilter.GRAY)
        assertEquals(76, px[0] and 0xFF); assertEquals(255, px[1] and 0xFF)
    }
}
