package com.pagio.engine.scan

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Un coin du document, en fraction de l'image (0..1) : indépendant de la taille de l'image. */
data class Corner(val x: Float, val y: Float)

/** Les quatre coins d'un document : haut-gauche, haut-droit, bas-droit, bas-gauche. */
data class Quad(val tl: Corner, val tr: Corner, val br: Corner, val bl: Corner) {
    val corners: List<Corner> get() = listOf(tl, tr, br, bl)
    fun with(index: Int, c: Corner): Quad = when (index) { 0 -> copy(tl = c); 1 -> copy(tr = c); 2 -> copy(br = c); else -> copy(bl = c) }

    /** Vrai si les quatre coins forment un quadrilatère convexe (sinon le redressement est impossible). */
    val isConvex: Boolean get() {
        val p = corners
        var sign = 0
        for (i in 0 until 4) {
            val a = p[i]; val b = p[(i + 1) % 4]; val c = p[(i + 2) % 4]
            val cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
            if (abs(cross) < 1e-6f) return false
            val s = if (cross > 0) 1 else -1
            if (sign == 0) sign = s else if (s != sign) return false
        }
        return true
    }

    companion object {
        /** Toute l'image, avec une petite marge pour que les poignées restent saisissables. */
        val FULL = Quad(Corner(0.04f, 0.04f), Corner(0.96f, 0.04f), Corner(0.96f, 0.96f), Corner(0.04f, 0.96f))
    }
}

/**
 * Résultat d'une détection. [sure] n'est vrai que si les quatre bords de la feuille sont visibles d'un bout à
 * l'autre et nettement à l'intérieur de l'image : c'est la condition pour photographier sans demander à l'utilisateur.
 */
data class Detection(val quad: Quad, val sure: Boolean)

enum class ScanFilter { ORIGINAL, DOCUMENT, GRAY, BLACK_WHITE }

/**
 * Scanner de Pagio, sans dépendance : détection des bords d'une feuille et amélioration de l'image.
 * Tout travaille sur des tableaux de pixels ARGB, ce qui permet de le tester hors d'un téléphone.
 */
object DocScan {

    /**
     * Cherche la feuille dans une image réduite ([pixels] ARGB, idéalement 200 à 400 px de côté).
     * Deux hypothèses sont essayées : la feuille est plus claire que le fond, ou elle diffère de la couleur
     * dominante des bords de l'image. Renvoie null si rien de crédible : l'utilisateur place alors les coins.
     */
    fun detect(pixels: IntArray, w: Int, h: Int): Quad? = locate(pixels, w, h)?.quad

    /** Comme [detect], avec en plus le degré de certitude (voir [Detection]). */
    fun locate(pixels: IntArray, w: Int, h: Int): Detection? {
        if (w < 16 || h < 16 || pixels.size < w * h) return null
        val lum = blur(IntArray(w * h) { luminance(pixels[it]) }, w, h)
        // Méthode principale : les quatre bords droits de la feuille. Elle marche aussi quand la feuille n'est guère
        // plus claire que la table. Les deux méthodes par zones ne servent que si elle ne trouve rien.
        edgeQuad(lum, w, h)?.let { return it }
        val candidates = ArrayList<Pair<Quad, Float>>()
        candidate(brightMask(lum), w, h)?.let { candidates += it }
        candidate(borderDifferenceMask(pixels, w, h), w, h)?.let { candidates += it }
        // Les méthodes par zones devinent une forme approximative : jamais assez sûres pour déclencher seules.
        return candidates.maxByOrNull { it.second }?.first?.let { Detection(it, false) }
    }

    // ------------------------------------------------------------------ Détection par les bords droits

    /** Droite repérée dans l'image : x·cos + y·sin = rho, [theta] étant l'angle (en degrés) de sa perpendiculaire. */
    private class Line(val theta: Int, val rho: Float, val votes: Int = 0) {
        val cos = Math.cos(Math.toRadians(theta.toDouble())).toFloat()
        val sin = Math.sin(Math.toRadians(theta.toDouble())).toFloat()
    }

    private fun angleGap(a: Int, b: Int): Int { val d = abs(a - b) % 180; return min(d, 180 - d) }

    /**
     * Cherche les contours (changements brusques de luminosité), en tire les droites les plus marquées (transformée
     * de Hough), puis retient le quadrilatère dont les quatre côtés suivent le mieux de vrais contours.
     */
    private fun edgeQuad(source: IntArray, w: Int, h: Int): Detection? {
        val n = w * h
        // Lissage supplémentaire : sans lui, un bord légèrement incliné apparaît comme un escalier de segments
        // horizontaux, et sa direction mesurée est fausse de plusieurs degrés.
        val lum = blur(source, w, h)
        val mag = IntArray(n); val ang = ShortArray(n)
        val hist = IntArray(512)
        for (y in 1 until h - 1) for (x in 1 until w - 1) {
            val i = y * w + x
            val gx = (lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1]) - (lum[i - w - 1] + 2 * lum[i - 1] + lum[i + w - 1])
            val gy = (lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]) - (lum[i - w - 1] + 2 * lum[i - w] + lum[i - w + 1])
            val m = abs(gx) + abs(gy)
            mag[i] = m; hist[min(511, m / 4)]++
            if (m > 0) { var a = Math.toDegrees(Math.atan2(gy.toDouble(), gx.toDouble())).roundToInt() % 180; if (a < 0) a += 180; ang[i] = a.toShort() }
        }
        // Seuil : les 20 % de pixels les plus contrastés, mais jamais en dessous d'un contraste franc.
        var acc = 0; var bucket = 511; val keep = (n * 0.20f).toInt()
        while (bucket > 0) { acc += hist[bucket]; if (acc > keep) break; bucket-- }
        // Plafonné : sur une page pleine de texte, le texte ne doit pas faire oublier le bord peu contrasté d'une
        // feuille blanche posée sur une table claire.
        val threshold = (bucket * 4).coerceIn(24, 48)

        val rhoMax = hypot(w.toFloat(), h.toFloat()).toInt() + 2
        val rhoBins = 2 * rhoMax + 1
        val raw = IntArray(180 * rhoBins)
        val cosT = FloatArray(180) { Math.cos(Math.toRadians(it.toDouble())).toFloat() }
        val sinT = FloatArray(180) { Math.sin(Math.toRadians(it.toDouble())).toFloat() }
        for (y in 1 until h - 1) for (x in 1 until w - 1) {
            val i = y * w + x
            if (mag[i] < threshold) continue
            // Chaque pixel de contour ne vote que pour les droites alignées avec lui : beaucoup moins de fausses droites.
            for (d in -3..3) {
                val t = (ang[i] + d + 180) % 180
                raw[t * rhoBins + (x * cosT[t] + y * sinT[t]).roundToInt() + rhoMax]++
            }
        }
        // Un bord incliné ne tombe jamais exactement dans une seule case : ses votes s'étalent sur les cases voisines.
        // On additionne donc chaque case avec ses voisines avant de chercher les droites les plus marquées.
        val votes = IntArray(raw.size)
        for (t in 0 until 180) for (r in 2 until rhoBins - 2) {
            var sum = 0
            for (dt in -1..1) { val tt = t + dt; if (tt < 0 || tt >= 180) continue; val base = tt * rhoBins + r; sum += raw[base - 2] + raw[base - 1] + raw[base] + raw[base + 1] + raw[base + 2] }
            votes[t * rhoBins + r] = sum
        }
        // Les droites les plus votées, sans doublons (une même droite peut se lire avec theta et theta + 180).
        val minVotes = max(60, min(w, h) / 2)
        val cells = ArrayList<Int>()
        for (c in votes.indices) if (votes[c] >= minVotes) cells += c
        cells.sortByDescending { votes[it] }
        val found = ArrayList<Line>()
        for (c in cells) {
            if (found.size >= 60) break
            val t = c / rhoBins; val r = (c % rhoBins - rhoMax).toFloat()
            val duplicate = found.any { l ->
                if (angleGap(l.theta, t) > 8) false
                else abs(if (abs(l.theta - t) > 90) -l.rho - r else l.rho - r) < 10f
            }
            if (!duplicate) found += Line(t, r, votes[c])
        }
        // Un texte imprimé produit des dizaines de droites parallèles. Par direction, on ne garde donc que les deux
        // plus marquées et les deux plus extérieures : les bords de la feuille entourent toujours le texte.
        val lines = ArrayList<Line>()
        val cx = w / 2f; val cy = h / 2f
        for (line in found) {
            val family = found.filter { angleGap(it.theta, line.theta) <= 10 }
            // Les droites faibles d'une famille (reflets, bouts de lettres alignés par hasard) ne comptent pas.
            val floor = family.maxOf { it.votes } * 0.3f
            if (line.votes < floor) continue
            val strong = family.filter { it.votes >= floor }
            // Écart de chaque droite au centre de l'image, mesuré le long de la perpendiculaire de la droite étudiée.
            fun offset(m: Line) = (m.rho - (cx * m.cos + cy * m.sin)) * (m.cos * line.cos + m.sin * line.sin)
            val own = offset(line)
            val outermost = strong.none { offset(it) < own - 0.5f } || strong.none { offset(it) > own + 0.5f }
            val amongStrongest = strong.count { it.votes > line.votes } < 2
            if (outermost || amongStrongest) lines += line
        }
        lines.sortByDescending { it.votes }
        while (lines.size > 20) lines.removeAt(lines.size - 1)
        if (lines.size < 4) return null

        // Paires de droites à peu près parallèles (côtés opposés), puis deux paires qui se croisent franchement.
        val pairs = ArrayList<Pair<Line, Line>>()
        for (i in lines.indices) for (j in i + 1 until lines.size) if (angleGap(lines[i].theta, lines[j].theta) <= 30) pairs += lines[i] to lines[j]
        var best: List<Pair<Float, Float>>? = null; var bestScore = 0f; var bestMean = 0f; var bestComplete = 0f
        val supportCache = HashMap<Long, FloatArray>()
        for (i in pairs.indices) for (j in i + 1 until pairs.size) {
            val (a1, a2) = pairs[i]; val (b1, b2) = pairs[j]
            if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue
            if (angleGap(a1.theta, b1.theta) < 40 || angleGap(a2.theta, b2.theta) < 40) continue
            val raw = listOf(cross(a1, b1) ?: continue, cross(a1, b2) ?: continue, cross(a2, b2) ?: continue, cross(a2, b1) ?: continue)
            if (raw.any { it.first < -0.06f * w || it.first > 1.06f * w || it.second < -0.06f * h || it.second > 1.06f * h }) continue
            val q = order(raw)
            val area = polygonArea(q)
            if (area < n * 0.10f) continue
            if (!plausible(q)) continue
            var sum = 0f; var weakest = 1f; var gaps = 0; var complete = 1f
            for (k in 0 until 4) {
                val p1 = q[k]; val p2 = q[(k + 1) % 4]
                val key = (p1.first.roundToInt().toLong() shl 48) or ((p1.second.roundToInt().toLong() and 0xFFFF) shl 32) or
                    ((p2.first.roundToInt().toLong() and 0xFFFF) shl 16) or (p2.second.roundToInt().toLong() and 0xFFFF)
                val s = supportCache.getOrPut(key) { sideSupport(p1, p2, mag, ang, threshold, w, h) }
                sum += s[0]; if (s[0] < weakest) weakest = s[0]
                if (s[1] < 0.25f) gaps++
                if (s[1] < complete) complete = s[1]
            }
            val mean = sum / 4f
            if (weakest < 0.45f || mean < 0.6f) continue
            // Un vrai bord de feuille est visible sur toute sa longueur. Un cadre trop grand (calé sur le bord de la
            // table ou une veine du bois) a des côtés qui dépassent dans le vide : on tolère un seul côté troué,
            // par exemple caché par un doigt.
            if (gaps > 1) continue
            // À qualité de contour égale, le plus grand cadre l'emporte : les lignes de texte dessinent des cadres plus petits.
            val score = area * mean * mean
            if (score > bestScore) { bestScore = score; best = q; bestMean = mean; bestComplete = complete }
        }
        val rough = best ?: return null
        val q = refine(rough, mag, ang, threshold, w, h)
        fun c(p: Pair<Float, Float>) = Corner((p.first / (w - 1f)).coerceIn(0f, 1f), (p.second / (h - 1f)).coerceIn(0f, 1f))
        val quad = Quad(c(q[0]), c(q[1]), c(q[2]), c(q[3])).takeIf { it.isConvex } ?: return null
        // Sûr : contours nets sur presque toute la longueur de chaque côté, aucun côté interrompu, et aucun coin collé
        // au bord de l'image (une feuille coupée par le cadrage a forcément un coin au bord).
        val inFrame = q.all { it.first > w * 0.03f && it.first < w * 0.97f && it.second > h * 0.03f && it.second < h * 0.97f }
        val large = polygonArea(q) >= n * 0.18f
        // La qualité est remesurée sur le cadre ajusté : le cadre brut, un peu décalé, la sous-estimerait.
        var mean = 0f; var complete = 1f
        for (k in 0 until 4) { val s = sideSupport(q[k], q[(k + 1) % 4], mag, ang, threshold, w, h); mean += s[0] / 4f; complete = min(complete, s[1]) }
        mean = max(mean, bestMean); complete = max(complete, bestComplete)
        return Detection(quad, mean >= 0.8f && complete >= 0.5f && inFrame && large)
    }

    /**
     * Recale chaque côté sur les pixels de contour qui le bordent (droite des moindres carrés), puis recalcule les
     * coins. La transformée de Hough donne un cadre au degré et au pixel près ; ceci gagne la précision restante.
     */
    private fun refine(q: List<Pair<Float, Float>>, mag: IntArray, ang: ShortArray, threshold: Int, w: Int, h: Int): List<Pair<Float, Float>> {
        // Chaque côté ajusté : un point (mx, my) et une direction (ux, uy).
        val fitted = ArrayList<FloatArray>()
        for (k in 0 until 4) {
            val p1 = q[k]; val p2 = q[(k + 1) % 4]
            val dx = p2.first - p1.first; val dy = p2.second - p1.second
            val length = hypot(dx, dy)
            val ux = dx / length; val uy = dy / length; val nx = -uy; val ny = ux
            var normal = (Math.toDegrees(Math.atan2(dy.toDouble(), dx.toDouble())).roundToInt() + 90) % 180; if (normal < 0) normal += 180
            var sx = 0.0; var sy = 0.0; var count = 0
            val xs = ArrayList<Float>(); val ys = ArrayList<Float>()
            val steps = length.toInt()
            // On s'écarte des coins : les pixels du côté voisin y fausseraient l'ajustement.
            for (i in (steps * 0.08f).toInt()..(steps * 0.92f).toInt()) {
                val bx = p1.first + ux * i; val by = p1.second + uy * i
                var bestMag = 0; var bestX = 0f; var bestY = 0f
                for (o in -4..4) {
                    val xx = (bx + nx * o).roundToInt(); val yy = (by + ny * o).roundToInt()
                    if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue
                    val j = yy * w + xx
                    if (mag[j] >= threshold && mag[j] > bestMag && angleGap(ang[j].toInt(), normal) <= 20) { bestMag = mag[j]; bestX = xx.toFloat(); bestY = yy.toFloat() }
                }
                if (bestMag > 0) { xs += bestX; ys += bestY; sx += bestX; sy += bestY; count++ }
            }
            if (count < 8) { fitted += floatArrayOf((p1.first + p2.first) / 2f, (p1.second + p2.second) / 2f, ux, uy); continue }
            val mx = (sx / count).toFloat(); val my = (sy / count).toFloat()
            var sxx = 0.0; var sxy = 0.0; var syy = 0.0
            for (i in 0 until count) { val a = xs[i] - mx; val b = ys[i] - my; sxx += a * a; sxy += a * b; syy += b * b }
            // Direction principale du nuage de points (axe de plus grande dispersion).
            val theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
            fitted += floatArrayOf(mx, my, Math.cos(theta).toFloat(), Math.sin(theta).toFloat())
        }
        val out = ArrayList<Pair<Float, Float>>()
        for (k in 0 until 4) {
            // Le coin k est à la rencontre du côté précédent et du côté k.
            val a = fitted[(k + 3) % 4]; val b = fitted[k]
            val det = a[2] * b[3] - a[3] * b[2]
            if (abs(det) < 1e-4f) return q
            val t = ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / det
            val x = a[0] + a[2] * t; val y = a[1] + a[3] * t
            // Garde-fou : un ajustement qui déplace un coin de plus de 12 pixels est une erreur, on garde le cadre initial.
            if (hypot(x - q[k].first, y - q[k].second) > 12f) return q
            out += x to y
        }
        return out
    }

    private fun cross(a: Line, b: Line): Pair<Float, Float>? {
        val det = a.cos * b.sin - a.sin * b.cos
        if (abs(det) < 1e-4f) return null
        return ((a.rho * b.sin - a.sin * b.rho) / det) to ((a.cos * b.rho - a.rho * b.cos) / det)
    }

    /** Écarte les formes qu'une feuille ne prend pas : côtés opposés trop inégaux, angles trop fermés ou trop ouverts. */
    private fun plausible(q: List<Pair<Float, Float>>): Boolean {
        fun len(i: Int) = hypot(q[(i + 1) % 4].first - q[i].first, q[(i + 1) % 4].second - q[i].second)
        val l = FloatArray(4) { len(it) }
        if (l.any { it < 8f }) return false
        if (max(l[0], l[2]) > 2.5f * min(l[0], l[2]) || max(l[1], l[3]) > 2.5f * min(l[1], l[3])) return false
        for (i in 0 until 4) {
            val p = q[i]; val a = q[(i + 3) % 4]; val b = q[(i + 1) % 4]
            val ux = a.first - p.first; val uy = a.second - p.second; val vx = b.first - p.first; val vy = b.second - p.second
            val cosine = (ux * vx + uy * vy) / (hypot(ux, uy) * hypot(vx, vy))
            if (abs(cosine) > 0.64f) return false   // angle hors de 50°–130°
        }
        return true
    }

    /**
     * Part d'un côté qui longe réellement un contour de même direction (0 = aucun, 1 = tout le côté), suivie de la
     * même mesure sur son cinquième le moins bien couvert.
     */
    private fun sideSupport(p1: Pair<Float, Float>, p2: Pair<Float, Float>, mag: IntArray, ang: ShortArray, threshold: Int, w: Int, h: Int): FloatArray {
        val dx = p2.first - p1.first; val dy = p2.second - p1.second
        val length = hypot(dx, dy)
        val samples = min(80, max(10, length.toInt()))
        val fifths = IntArray(5); val fifthSizes = IntArray(5)
        var normal = (Math.toDegrees(Math.atan2(dy.toDouble(), dx.toDouble())).roundToInt() + 90) % 180; if (normal < 0) normal += 180
        val nx = -dy / length; val ny = dx / length
        var hit = 0
        for (k in 0 until samples) {
            val t = (k + 0.5f) / samples
            val x = p1.first + dx * t; val y = p1.second + dy * t
            var found = false
            for (o in -3..3) {
                val xx = (x + nx * o).roundToInt(); val yy = (y + ny * o).roundToInt()
                if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue
                val i = yy * w + xx
                if (mag[i] >= threshold && angleGap(ang[i].toInt(), normal) <= 20) { found = true; break }
            }
            val part = min(4, k * 5 / samples); fifthSizes[part]++
            if (found) { hit++; fifths[part]++ }
        }
        var worst = 1f
        for (i in 0 until 5) if (fifthSizes[i] > 0) worst = min(worst, fifths[i].toFloat() / fifthSizes[i])
        return floatArrayOf(hit.toFloat() / samples, worst)
    }

    // ------------------------------------------------------------------ Détection par zones (secours)

    private fun luminance(c: Int): Int = (((c shr 16) and 0xFF) * 299 + ((c shr 8) and 0xFF) * 587 + (c and 0xFF) * 114) / 1000

    /** Flou léger (moyenne 3×3, deux passes) : gomme le texte et le grain sans effacer les bords de la feuille. */
    private fun blur(src: IntArray, w: Int, h: Int): IntArray {
        var a = src
        repeat(2) {
            val b = IntArray(w * h)
            for (y in 0 until h) for (x in 0 until w) {
                var s = 0; var n = 0
                for (dy in -1..1) { val yy = y + dy; if (yy < 0 || yy >= h) continue
                    for (dx in -1..1) { val xx = x + dx; if (xx < 0 || xx >= w) continue; s += a[yy * w + xx]; n++ } }
                b[y * w + x] = s / n
            }
            a = b
        }
        return a
    }

    /** Seuil d'Otsu : sépare au mieux les pixels clairs (feuille) des pixels sombres (table). */
    private fun brightMask(lum: IntArray): BooleanArray {
        val hist = IntArray(256); for (v in lum) hist[v.coerceIn(0, 255)]++
        val total = lum.size
        var sumAll = 0.0; for (i in 0..255) sumAll += i * hist[i].toDouble()
        var sumB = 0.0; var wB = 0; var best = 0.0; var threshold = 127
        for (t in 0..255) {
            wB += hist[t]; if (wB == 0) continue
            val wF = total - wB; if (wF == 0) break
            sumB += t * hist[t].toDouble()
            val mB = sumB / wB; val mF = (sumAll - sumB) / wF
            val between = wB.toDouble() * wF * (mB - mF) * (mB - mF)
            if (between > best) { best = between; threshold = t }
        }
        return BooleanArray(lum.size) { lum[it] > threshold }
    }

    /** Pixels dont la couleur s'éloigne de la couleur médiane des bords de l'image (supposés montrer le fond). */
    private fun borderDifferenceMask(pixels: IntArray, w: Int, h: Int): BooleanArray {
        val rs = ArrayList<Int>(); val gs = ArrayList<Int>(); val bs = ArrayList<Int>()
        val band = max(1, min(w, h) / 40)
        for (y in 0 until h) for (x in 0 until w) {
            if (x < band || y < band || x >= w - band || y >= h - band) {
                val c = pixels[y * w + x]; rs += (c shr 16) and 0xFF; gs += (c shr 8) and 0xFF; bs += c and 0xFF
            }
        }
        rs.sort(); gs.sort(); bs.sort()
        val r0 = rs[rs.size / 2]; val g0 = gs[gs.size / 2]; val b0 = bs[bs.size / 2]
        val dist = IntArray(w * h) {
            val c = pixels[it]
            abs(((c shr 16) and 0xFF) - r0) + abs(((c shr 8) and 0xFF) - g0) + abs((c and 0xFF) - b0)
        }
        val smooth = blur(dist, w, h)
        val sorted = smooth.copyOf().also { it.sort() }
        // Seuil : au moins 60 (différence nette), ou la moitié de l'écart le plus fréquent parmi les pixels éloignés.
        val threshold = max(60, sorted[(sorted.size * 0.95f).toInt().coerceAtMost(sorted.size - 1)] / 2)
        return BooleanArray(w * h) { smooth[it] > threshold }
    }

    /** Plus grande zone d'un masque → enveloppe convexe → meilleur quadrilatère, avec une note de confiance. */
    private fun candidate(mask: BooleanArray, w: Int, h: Int): Pair<Quad, Float>? {
        val comp = largestComponent(mask, w, h) ?: return null
        val total = w * h
        if (comp.size < total * 0.10f || comp.size > total * 0.985f) return null
        // Une zone qui longe plus de la moitié du tour de l'image est le fond (la table), pas la feuille.
        var edge = 0
        for (p in comp) { val x = p % w; val y = p / w; if (x == 0 || y == 0 || x == w - 1 || y == h - 1) edge++ }
        if (edge > (w + h)) return null
        val hull = convexHull(comp, w)
        if (hull.size < 4) return null
        val quad = largestQuad(hull) ?: return null
        val area = polygonArea(quad)
        if (area < total * 0.10f) return null
        // Une feuille remplit presque tout son quadrilatère ; une tache quelconque non. Les trous de la zone
        // (texte, tampons, photos imprimées) sont comptés comme faisant partie de la feuille.
        val inside = BooleanArray(total); for (p in comp) inside[p] = true
        val fill = (total - outsideCount(inside, w, h)) / area
        if (fill < 0.75f || fill > 1.25f) return null
        val ordered = order(quad)
        val q = Quad(
            Corner(ordered[0].first / (w - 1f), ordered[0].second / (h - 1f)), Corner(ordered[1].first / (w - 1f), ordered[1].second / (h - 1f)),
            Corner(ordered[2].first / (w - 1f), ordered[2].second / (h - 1f)), Corner(ordered[3].first / (w - 1f), ordered[3].second / (h - 1f)),
        )
        if (!q.isConvex) return null
        // Note : proche de 1 quand la zone épouse exactement son quadrilatère.
        return q to (1f - abs(1f - fill))
    }

    /** Plus grande zone connexe du masque (parcours en largeur). Renvoie les indices de ses pixels. */
    private fun largestComponent(mask: BooleanArray, w: Int, h: Int): IntArray? {
        val seen = BooleanArray(mask.size)
        val queue = IntArray(mask.size)
        var best: IntArray? = null
        for (start in mask.indices) {
            if (!mask[start] || seen[start]) continue
            var head = 0; var tail = 0
            queue[tail++] = start; seen[start] = true
            while (head < tail) {
                val p = queue[head++]; val x = p % w; val y = p / w
                if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = true; queue[tail++] = p - 1 }
                if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = true; queue[tail++] = p + 1 }
                if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = true; queue[tail++] = p - w }
                if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = true; queue[tail++] = p + w }
            }
            if (best == null || tail > best.size) best = queue.copyOfRange(0, tail)
        }
        return best
    }

    /** Nombre de pixels hors de la zone et reliés au bord de l'image : tout le reste est la zone, trous compris. */
    private fun outsideCount(inside: BooleanArray, w: Int, h: Int): Int {
        val seen = BooleanArray(inside.size)
        val queue = IntArray(inside.size)
        var head = 0; var tail = 0
        fun push(p: Int) { if (!inside[p] && !seen[p]) { seen[p] = true; queue[tail++] = p } }
        for (x in 0 until w) { push(x); push((h - 1) * w + x) }
        for (y in 0 until h) { push(y * w); push(y * w + w - 1) }
        while (head < tail) {
            val p = queue[head++]; val x = p % w; val y = p / w
            if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w)
        }
        return tail
    }

    /** Enveloppe convexe (chaîne monotone d'Andrew) : seuls les extrêmes de chaque ligne peuvent en faire partie. */
    private fun convexHull(comp: IntArray, w: Int): List<Pair<Float, Float>> {
        val minX = HashMap<Int, Int>(); val maxX = HashMap<Int, Int>()
        for (p in comp) {
            val x = p % w; val y = p / w
            val a = minX[y]; if (a == null || x < a) minX[y] = x
            val b = maxX[y]; if (b == null || x > b) maxX[y] = x
        }
        val pts = ArrayList<Pair<Float, Float>>()
        for ((y, x) in minX) { pts += x.toFloat() to y.toFloat(); val x2 = maxX[y]!!; if (x2 != x) pts += x2.toFloat() to y.toFloat() }
        pts.sortWith(compareBy({ it.first }, { it.second }))
        if (pts.size < 3) return pts
        fun cross(o: Pair<Float, Float>, a: Pair<Float, Float>, b: Pair<Float, Float>) =
            (a.first - o.first) * (b.second - o.second) - (a.second - o.second) * (b.first - o.first)
        val hull = ArrayList<Pair<Float, Float>>()
        for (p in pts) { while (hull.size >= 2 && cross(hull[hull.size - 2], hull[hull.size - 1], p) <= 0) hull.removeAt(hull.size - 1); hull += p }
        val lower = hull.size + 1
        for (i in pts.size - 2 downTo 0) {
            val p = pts[i]
            while (hull.size >= lower && cross(hull[hull.size - 2], hull[hull.size - 1], p) <= 0) hull.removeAt(hull.size - 1)
            hull += p
        }
        hull.removeAt(hull.size - 1)
        return hull
    }

    private fun polygonArea(p: List<Pair<Float, Float>>): Float {
        var s = 0f
        for (i in p.indices) { val a = p[i]; val b = p[(i + 1) % p.size]; s += a.first * b.second - b.first * a.second }
        return abs(s) / 2f
    }

    /** Quadrilatère de plus grande surface dont les sommets sont pris sur l'enveloppe (réduite à 36 points au plus). */
    private fun largestQuad(hullIn: List<Pair<Float, Float>>): List<Pair<Float, Float>>? {
        // Simplification : on retire tour à tour le point qui change le moins la forme (plus petit triangle avec ses
        // voisins). Les vrais coins, qui portent les plus grands triangles, sont conservés.
        val hull = ArrayList(hullIn)
        while (hull.size > 24) {
            var worst = 0; var smallest = Float.MAX_VALUE
            for (i in hull.indices) {
                val a = hull[(i + hull.size - 1) % hull.size]; val b = hull[i]; val c = hull[(i + 1) % hull.size]
                val t = abs((b.first - a.first) * (c.second - a.second) - (b.second - a.second) * (c.first - a.first))
                if (t < smallest) { smallest = t; worst = i }
            }
            hull.removeAt(worst)
        }
        val n = hull.size
        if (n < 4) return null
        var best = 0f; var res: List<Pair<Float, Float>>? = null
        for (i in 0 until n - 3) for (j in i + 1 until n - 2) for (k in j + 1 until n - 1) for (l in k + 1 until n) {
            val q = listOf(hull[i], hull[j], hull[k], hull[l])
            val a = polygonArea(q)
            if (a > best) { best = a; res = q }
        }
        return res
    }

    /** Range quatre points dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche. */
    private fun order(p: List<Pair<Float, Float>>): List<Pair<Float, Float>> {
        val cx = p.sumOf { it.first.toDouble() } / 4; val cy = p.sumOf { it.second.toDouble() } / 4
        // Tri par angle autour du centre (sens horaire à l'écran), puis départ au point le plus proche du coin haut-gauche.
        val sorted = p.sortedBy { Math.atan2(it.second - cy, it.first - cx) }
        val start = sorted.indices.minByOrNull { sorted[it].first + sorted[it].second } ?: 0
        return List(4) { sorted[(start + it) % 4] }
    }

    // ------------------------------------------------------------------ Taille de sortie

    /** Taille du document redressé (en pixels) d'après la longueur de ses côtés dans une image [w]×[h]. */
    fun outputSize(q: Quad, w: Int, h: Int, maxDimension: Int): Pair<Int, Int> {
        fun d(a: Corner, b: Corner) = hypot((a.x - b.x) * w, (a.y - b.y) * h)
        var ow = max(d(q.tl, q.tr), d(q.bl, q.br))
        var oh = max(d(q.tl, q.bl), d(q.tr, q.br))
        val scale = min(1f, maxDimension / max(ow, oh))
        ow *= scale; oh *= scale
        return max(8, ow.roundToInt()) to max(8, oh.roundToInt())
    }

    // ------------------------------------------------------------------ Filtres

    /**
     * Applique un filtre sur place. DOCUMENT et BLACK_WHITE corrigent l'éclairage : la luminosité du papier est
     * estimée par zones puis ramenée au blanc, ce qui efface les ombres et le voile gris des photos.
     */
    fun applyFilter(pixels: IntArray, w: Int, h: Int, filter: ScanFilter) {
        when (filter) {
            ScanFilter.ORIGINAL -> return
            ScanFilter.GRAY -> for (i in 0 until w * h) { val l = luminance(pixels[i]); pixels[i] = (0xFF shl 24) or (l shl 16) or (l shl 8) or l }
            ScanFilter.DOCUMENT, ScanFilter.BLACK_WHITE -> {
                val bg = paperBrightness(pixels, w, h)
                val bw = filter == ScanFilter.BLACK_WHITE
                for (y in 0 until h) for (x in 0 until w) {
                    val i = y * w + x
                    val gain = 255f / max(40f, bg.at(x, y))
                    val c = pixels[i]
                    if (bw) {
                        val n = luminance(c) * gain / 255f
                        // Contraste fort : le papier devient blanc, l'encre noire, les gris intermédiaires restent lisses.
                        val v = (((n - 0.62f) * 3.4f + 0.5f).coerceIn(0f, 1f) * 255f).toInt()
                        pixels[i] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
                    } else {
                        val r = curve(((c shr 16) and 0xFF) * gain); val g = curve(((c shr 8) and 0xFF) * gain); val b = curve((c and 0xFF) * gain)
                        pixels[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                    }
                }
            }
        }
    }

    /** Légère accentuation du contraste, en gardant les couleurs. */
    private fun curve(v: Float): Int {
        val n = (v / 255f).coerceIn(0f, 1.2f)
        return (((n - 0.5f) * 1.25f + 0.5f).coerceIn(0f, 1f) * 255f).toInt()
    }

    private class Grid(val cols: Int, val rows: Int, val cell: Float, val values: FloatArray) {
        /** Valeur interpolée entre les centres des cases voisines. */
        fun at(x: Int, y: Int): Float {
            val gx = (x / cell - 0.5f).coerceIn(0f, cols - 1f); val gy = (y / cell - 0.5f).coerceIn(0f, rows - 1f)
            val x0 = gx.toInt(); val y0 = gy.toInt(); val x1 = min(cols - 1, x0 + 1); val y1 = min(rows - 1, y0 + 1)
            val fx = gx - x0; val fy = gy - y0
            val top = values[y0 * cols + x0] * (1 - fx) + values[y0 * cols + x1] * fx
            val bottom = values[y1 * cols + x0] * (1 - fx) + values[y1 * cols + x1] * fx
            return top * (1 - fy) + bottom * fy
        }
    }

    /** Luminosité du papier par case : le 85e centile de chaque case ignore le texte, plus sombre. */
    private fun paperBrightness(pixels: IntArray, w: Int, h: Int): Grid {
        val cell = max(8f, max(w, h) / 24f)
        val cols = max(1, Math.ceil((w / cell).toDouble()).toInt()); val rows = max(1, Math.ceil((h / cell).toDouble()).toInt())
        val values = FloatArray(cols * rows)
        val hist = IntArray(256)
        for (gy in 0 until rows) for (gx in 0 until cols) {
            hist.fill(0); var n = 0
            val x0 = (gx * cell).toInt(); val x1 = min(w, ((gx + 1) * cell).toInt()); val y0 = (gy * cell).toInt(); val y1 = min(h, ((gy + 1) * cell).toInt())
            var y = y0
            while (y < y1) { var x = x0; while (x < x1) { hist[luminance(pixels[y * w + x])]++; n++; x += 2 }; y += 2 }
            var acc = 0; var v = 255
            val target = (n * 0.15f).toInt()
            while (v > 0) { acc += hist[v]; if (acc > target) break; v-- }
            values[gy * cols + gx] = v.toFloat()
        }
        // Lissage entre cases voisines : évite les marches visibles et les cases entièrement couvertes d'encre.
        val smooth = FloatArray(values.size)
        for (gy in 0 until rows) for (gx in 0 until cols) {
            var s = 0f; var m = 0f; var n = 0
            for (dy in -1..1) for (dx in -1..1) {
                val xx = gx + dx; val yy = gy + dy
                if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue
                val v = values[yy * cols + xx]; s += v; n++; if (v > m) m = v
            }
            // Mélange de la moyenne et du maximum local : une case sombre (image, gros titre) hérite du papier voisin.
            smooth[gy * cols + gx] = (s / n) * 0.5f + m * 0.5f
        }
        return Grid(cols, rows, cell, smooth)
    }
}
