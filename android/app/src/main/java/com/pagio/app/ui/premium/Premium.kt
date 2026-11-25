package com.pagio.app.ui.premium

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.AllInclusive
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.FileUpload
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.rotate as rotateDraw
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pagio.app.R
import com.pagio.app.container
import kotlinx.coroutines.delay
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

// Présentation de Pagio Premium : bannière animée (Réglages, Compte) et écran complet (avantages qui apparaissent au
// défilement, comparaison, offres, questions) avec un bouton d'abonnement toujours visible en bas.
// Identité propre à Pagio : dégradé indigo → violet → corail et étoile scintillante à quatre branches.

private val Indigo = Color(0xFF4535C9)
private val Violet = Color(0xFF7A5CF0)
private val Coral = Color(0xFFFF7A66)
private val Night = Color(0xFF12112A)

private fun money(n: Int) = NumberFormat.getIntegerInstance(Locale.FRANCE).format(n).replace(' ', ' ').replace(' ', ' ') + " F"

/** Étoile à quatre branches (le scintillement de Pagio), centrée en (cx, cy). */
private fun sparkPath(cx: Float, cy: Float, r: Float, inner: Float = 0.26f): Path = Path().apply {
    for (i in 0 until 8) {
        val a = (i * 45.0 - 90.0) * PI / 180.0
        val rad = if (i % 2 == 0) r else r * inner
        val x = cx + (rad * cos(a)).toFloat(); val y = cy + (rad * sin(a)).toFloat()
        if (i == 0) moveTo(x, y) else lineTo(x, y)
    }
    close()
}

/** Emblème animé : grande étoile qui respire et tourne doucement, halo, et deux petites étoiles en orbite. */
@Composable
fun PremiumEmblem(modifier: Modifier = Modifier, light: Boolean = true) {
    val t = rememberInfiniteTransition(label = "emblem")
    val pulse by t.animateFloat(0.92f, 1.06f, infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "pulse")
    val turn by t.animateFloat(0f, 360f, infiniteRepeatable(tween(14000, easing = LinearEasing)), label = "turn")
    val orbit by t.animateFloat(0f, 1f, infiniteRepeatable(tween(5200, easing = LinearEasing)), label = "orbit")
    Canvas(modifier) {
        val c = Offset(size.width / 2, size.height / 2)
        val r = size.minDimension / 2
        drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = if (light) 0.45f else 0.30f), Color.Transparent), c, r), r, c)
        rotateDraw(turn / 8f, c) {
            drawPath(sparkPath(c.x, c.y, r * 0.62f * pulse),
                Brush.linearGradient(if (light) listOf(Color.White, Color(0xFFFFE3DD)) else listOf(Violet, Coral), Offset(c.x - r, c.y - r), Offset(c.x + r, c.y + r)))
        }
        for (k in 0 until 2) {
            val a = (orbit + k * 0.5f) * 2 * PI
            val p = Offset(c.x + (r * 0.82f * cos(a)).toFloat(), c.y + (r * 0.82f * sin(a)).toFloat())
            drawPath(sparkPath(p.x, p.y, r * (0.13f + 0.04f * k)), if (light) Color.White else Coral)
        }
    }
}

/** Bannière « Passez à Premium » : dégradé qui ondule, reflet lumineux qui la traverse, étincelles. */
@Composable
fun PremiumBanner(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "banner")
    val shift by t.animateFloat(0f, 1f, infiniteRepeatable(tween(6000, easing = LinearEasing), RepeatMode.Reverse), label = "shift")
    val shine by t.animateFloat(-0.4f, 1.4f, infiniteRepeatable(tween(2800, delayMillis = 900, easing = FastOutSlowInEasing)), label = "shine")
    val twinkle by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1300), RepeatMode.Reverse), label = "twinkle")
    Box(
        modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp))
            .drawWithContent {
                val w = size.width; val h = size.height
                drawRect(Brush.linearGradient(listOf(Indigo, Violet, Coral), Offset(-w * 0.3f + w * 0.3f * shift, 0f), Offset(w * (1f + 0.3f * shift), h)))
                // étincelles fixes qui scintillent
                listOf(Triple(0.74f, 0.22f, 7f), Triple(0.9f, 0.7f, 5f), Triple(0.62f, 0.82f, 4f), Triple(0.97f, 0.18f, 4f)).forEachIndexed { i, (x, y, s) ->
                    val a = if (i % 2 == 0) twinkle else 1f - twinkle
                    drawPath(sparkPath(w * x, h * y, s.dp.toPx()), Color.White.copy(alpha = 0.25f + 0.6f * a))
                }
                drawContent()
                // reflet en diagonale
                val x = w * shine
                drawRect(Brush.linearGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.28f), Color.Transparent), Offset(x - w * 0.18f, 0f), Offset(x + w * 0.18f, h)))
            }
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.prem_banner_kicker), color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.labelMedium, letterSpacing = 1.2.sp)
                Text(stringResource(R.string.prem_banner_title), color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(2.dp))
                Text(stringResource(R.string.prem_banner_text), color = Color.White.copy(alpha = 0.92f), style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(10.dp))
                Row(Modifier.clip(CircleShape).background(Color.White).padding(horizontal = 14.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.prem_banner_cta), color = Indigo, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, tint = Indigo, modifier = Modifier.size(16.dp))
                }
            }
            PremiumEmblem(Modifier.size(92.dp))
        }
    }
}

private data class Benefit(val icon: ImageVector, val title: String, val text: String, val tint: Color)
private data class Plan(val key: String, val label: String, val price: Int, val per: String, val note: String?, val badge: String?)

/** Apparition au défilement : chaque bloc arrive en fondu, monte et grandit légèrement (une seule fois). */
@Composable
private fun Reveal(key: String, seen: MutableMap<String, Boolean>, delayMs: Int = 0, content: @Composable () -> Unit) {
    val a = remember { Animatable(if (seen[key] == true) 1f else 0f) }
    LaunchedEffect(key) {
        if (a.value < 1f) { delay(delayMs.toLong()); a.animateTo(1f, tween(620, easing = FastOutSlowInEasing)); seen[key] = true }
    }
    Box(Modifier.graphicsLayer {
        alpha = a.value; translationY = (1f - a.value) * 90f
        val s = 0.92f + 0.08f * a.value; scaleX = s; scaleY = s
    }) { content() }
}

@Composable
fun PremiumScreen(onBack: () -> Unit, onLogin: () -> Unit) {
    val context = LocalContext.current
    val c = context.container
    val config by c.config.collectAsState()
    val account by c.account.collectAsState()
    val prices = config.prices
    val free = config.freeLimits
    val prem = config.premiumLimits
    val credits = if (prices.premiumAiCredits > 0) prices.premiumAiCredits else prem.aiCredits
    LaunchedEffect(Unit) { c.track("premium_view", mapOf("logged_in" to (account != null), "premium" to (account?.isPremium == true))) }

    val plans = buildList {
        if (prices.week > 0) add(Plan("week", stringResource(R.string.prem_week), prices.week, stringResource(R.string.prem_per_week), null, null))
        if (prices.month > 0) add(Plan("month", stringResource(R.string.prem_month), prices.month, stringResource(R.string.prem_per_month), null, stringResource(R.string.prem_popular)))
        if (prices.year > 0) {
            val save = if (prices.month > 0) Math.round((1 - prices.year.toDouble() / (prices.month * 12)) * 100).toInt() else 0
            add(Plan("year", stringResource(R.string.prem_year), prices.year, stringResource(R.string.prem_per_year),
                stringResource(R.string.prem_year_note, money(prices.year / 12)), if (save > 0) stringResource(R.string.prem_save, save) else null))
        }
    }
    var selected by rememberSaveable { mutableStateOf("month") }
    val plan = plans.firstOrNull { it.key == selected } ?: plans.firstOrNull()
    var askPay by remember { mutableStateOf(false) }
    val seen = remember { mutableStateMapOf<String, Boolean>() }
    val list = rememberLazyListState()

    val benefits = listOf(
        Benefit(Icons.Outlined.AllInclusive, stringResource(R.string.prem_b1_t), stringResource(R.string.prem_b1_d), Violet),
        Benefit(Icons.Outlined.AutoAwesome, stringResource(R.string.prem_b2_t, credits), stringResource(R.string.prem_b2_d), Coral),
        Benefit(Icons.Outlined.Extension, stringResource(R.string.prem_b3_t), stringResource(R.string.prem_b3_d), Indigo),
        Benefit(Icons.Outlined.DocumentScanner, stringResource(R.string.prem_b4_t), stringResource(R.string.prem_b4_d), Color(0xFF14A37F)),
        Benefit(Icons.Outlined.FileUpload, stringResource(R.string.prem_b5_t), if (prem.maxMb > 0) stringResource(R.string.prem_b5_d, prem.maxMb) else stringResource(R.string.prem_b5_d_unlimited), Color(0xFF0EA5E9)),
        Benefit(Icons.Outlined.Bolt, stringResource(R.string.prem_b6_t), stringResource(R.string.prem_b6_d), Color(0xFFF59E0B)),
        Benefit(Icons.Outlined.FavoriteBorder, stringResource(R.string.prem_b7_t), stringResource(R.string.prem_b7_d), Color(0xFFE5484D)),
    )

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        LazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
            // En-tête : glisse et s'efface quand on fait défiler.
            item(key = "hero") {
                val t = rememberInfiniteTransition(label = "hero")
                val drift by t.animateFloat(0f, 1f, infiniteRepeatable(tween(9000, easing = LinearEasing), RepeatMode.Reverse), label = "drift")
                Box(
                    Modifier.fillMaxWidth().height(360.dp)
                        .graphicsLayer {
                            val off = if (list.firstVisibleItemIndex == 0) list.firstVisibleItemScrollOffset.toFloat() else size.height
                            translationY = off * 0.45f; alpha = (1f - off / size.height).coerceIn(0f, 1f)
                        }
                        .drawWithContent {
                            val w = size.width; val h = size.height
                            drawRect(Brush.linearGradient(listOf(Night, Indigo, Violet, Coral), Offset(0f, 0f), Offset(w, h * 1.1f)))
                            drawCircle(Brush.radialGradient(listOf(Coral.copy(alpha = 0.55f), Color.Transparent), Offset(w * (0.15f + 0.3f * drift), h * 0.85f), w * 0.55f), w * 0.55f, Offset(w * (0.15f + 0.3f * drift), h * 0.85f))
                            drawCircle(Brush.radialGradient(listOf(Violet.copy(alpha = 0.6f), Color.Transparent), Offset(w * (0.95f - 0.3f * drift), h * 0.2f), w * 0.5f), w * 0.5f, Offset(w * (0.95f - 0.3f * drift), h * 0.2f))
                            drawContent()
                        },
                ) {
                    Column(Modifier.fillMaxSize().statusBarsPadding().padding(top = 40.dp, start = 24.dp, end = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        PremiumEmblem(Modifier.size(120.dp))
                        Spacer(Modifier.height(12.dp))
                        Text("Pagio Premium", color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold)
                        Spacer(Modifier.height(8.dp))
                        Text(stringResource(R.string.prem_hero_text), color = Color.White.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                    }
                }
            }
            item(key = "b-title") {
                Reveal("b-title", seen) {
                    Text(stringResource(R.string.prem_unlock), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 8.dp))
                }
            }
            benefits.forEachIndexed { i, b ->
                item(key = "b$i") {
                    Reveal("b$i", seen, delayMs = if (i < 3) i * 90 else 0) { BenefitCard(b) }
                }
            }
            item(key = "compare") { Reveal("compare", seen) { Compare(free.aiCredits, credits) } }
            if (plans.isNotEmpty()) {
                item(key = "plans-title") {
                    Reveal("plans-title", seen) {
                        Text(stringResource(R.string.prem_choose), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 28.dp, bottom = 4.dp))
                    }
                }
                plans.forEachIndexed { i, p ->
                    item(key = "plan-${p.key}") {
                        Reveal("plan-${p.key}", seen, delayMs = i * 80) {
                            PlanCard(p, selected = plan?.key == p.key) { selected = p.key; c.track("premium_plan", mapOf("plan" to p.key)) }
                        }
                    }
                }
            }
            item(key = "trust") { Reveal("trust", seen) { Trust() } }
            item(key = "faq") { Reveal("faq", seen) { Faq() } }
            item(key = "end") { Spacer(Modifier.height(190.dp)) }
        }

        // Barre du haut : invisible sur l'en-tête, elle apparaît en fondu dès qu'on le quitte (le texte ne passe plus
        // sous l'heure et la batterie). La flèche de retour reste toujours accessible.
        val bar = if (list.firstVisibleItemIndex > 0) 1f else (list.firstVisibleItemScrollOffset / 600f).coerceIn(0f, 1f)
        val surface = MaterialTheme.colorScheme.surface
        val onSurface = MaterialTheme.colorScheme.onSurface
        Box(Modifier.fillMaxWidth().graphicsLayer { alpha = bar }.background(surface).statusBarsPadding().height(56.dp)) {
            Text("Pagio Premium", Modifier.align(Alignment.Center), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = onSurface)
        }
        IconButton(onClick = onBack, modifier = Modifier.statusBarsPadding().padding(4.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.22f * (1f - bar)))) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back), tint = if (bar > 0.5f) onSurface else Color.White)
        }

        // Bouton d'abonnement, toujours visible.
        SubscribeBar(
            modifier = Modifier.align(Alignment.BottomCenter),
            plan = plan, isPremium = account?.isPremium == true, premiumUntil = account?.premiumUntil,
        ) {
            c.track("premium_cta", mapOf("plan" to (plan?.key ?: ""), "logged_in" to (account != null)))
            if (account == null) onLogin() else askPay = true
        }
    }

    if (askPay && plan != null) {
        val acc = account
        AlertDialog(
            onDismissRequest = { askPay = false },
            icon = { PremiumEmblem(Modifier.size(56.dp), light = false) },
            title = { Text(stringResource(R.string.prem_pay_title)) },
            text = { Text(stringResource(R.string.prem_pay_text, plan.label.lowercase(), money(plan.price))) },
            confirmButton = {
                TextButton(onClick = {
                    askPay = false
                    val to = config.supportEmail.ifBlank { "contact@pagio.site" }
                    val subject = context.getString(R.string.prem_mail_subject, plan.label)
                    val body = context.getString(R.string.prem_mail_body, plan.label, money(plan.price), acc?.email ?: "")
                    val i = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
                        .putExtra(Intent.EXTRA_SUBJECT, subject).putExtra(Intent.EXTRA_TEXT, body)
                    runCatching { context.startActivity(i) }
                    c.track("premium_contact", mapOf("plan" to plan.key))
                }) { Text(stringResource(R.string.prem_pay_mail)) }
            },
            dismissButton = { TextButton(onClick = { askPay = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun BenefitCard(b: Benefit) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp,
        border = BorderStroke(1.dp, b.tint.copy(alpha = 0.18f)),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(Brush.linearGradient(listOf(b.tint, b.tint.copy(alpha = 0.65f)))), contentAlignment = Alignment.Center) {
                Icon(b.icon, null, tint = Color.White, modifier = Modifier.size(28.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(b.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(b.text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun Compare(freeCredits: Int, premiumCredits: Int) {
    val rows = listOf(
        Triple(stringResource(R.string.prem_c_tools), stringResource(R.string.prem_c_tools_free), stringResource(R.string.prem_c_unlimited)),
        Triple(stringResource(R.string.prem_c_ai), stringResource(R.string.prem_c_ai_free, freeCredits), stringResource(R.string.prem_c_ai_prem, premiumCredits)),
        Triple(stringResource(R.string.prem_c_premium_tools), "✗", "✓"),
        Triple(stringResource(R.string.prem_c_scan_pdf), "✗", "✓"),
        Triple(stringResource(R.string.prem_c_priority), "✗", "✓"),
    )
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 28.dp)) {
        Text(stringResource(R.string.prem_compare), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
        Surface(shape = RoundedCornerShape(20.dp), tonalElevation = 2.dp, color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(vertical = 6.dp)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Spacer(Modifier.weight(1.3f))
                    Text(stringResource(R.string.plan_free), Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Premium", Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(Brush.horizontalGradient(listOf(Violet, Coral))).padding(vertical = 4.dp),
                        textAlign = TextAlign.Center, style = MaterialTheme.typography.labelLarge, color = Color.White, fontWeight = FontWeight.Bold)
                }
                rows.forEach { (label, f, p) ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(label, Modifier.weight(1.3f), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        Cell(f, false, Modifier.weight(1f)); Cell(p, true, Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun Cell(v: String, premium: Boolean, modifier: Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        when (v) {
            "✓" -> Icon(Icons.Outlined.Check, null, tint = if (premium) Coral else MaterialTheme.colorScheme.onSurfaceVariant)
            "✗" -> Icon(Icons.Outlined.Close, null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(18.dp))
            else -> Text(v, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall, fontWeight = if (premium) FontWeight.Bold else FontWeight.Normal,
                color = if (premium) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun PlanCard(p: Plan, selected: Boolean, onClick: () -> Unit) {
    val border by animateColorAsState(if (selected) Coral else MaterialTheme.colorScheme.outlineVariant, label = "border")
    val scale by animateFloatAsState(if (selected) 1f else 0.97f, label = "scale")
    Box(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).graphicsLayer { scaleX = scale; scaleY = scale }) {
        Surface(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).clickable(onClick = onClick),
            shape = RoundedCornerShape(20.dp), border = BorderStroke(if (selected) 2.dp else 1.dp, border),
            color = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f) else MaterialTheme.colorScheme.surface,
        ) {
            Row(Modifier.padding(horizontal = 18.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(22.dp).clip(CircleShape).border(2.dp, border, CircleShape).background(if (selected) Coral else Color.Transparent), contentAlignment = Alignment.Center) {
                    if (selected) Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(14.dp))
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    p.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(money(p.price), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text(p.per, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        p.badge?.let {
            Text(it, color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd).padding(end = 18.dp).graphicsLayer { translationY = -22f }
                    .clip(CircleShape).background(Brush.horizontalGradient(listOf(Violet, Coral))).padding(horizontal = 10.dp, vertical = 3.dp))
        }
    }
}

@Composable
private fun Trust() {
    val items = listOf(
        Icons.Outlined.PhoneAndroid to stringResource(R.string.prem_t1),
        Icons.Outlined.Sync to stringResource(R.string.prem_t2),
        Icons.Outlined.Lock to stringResource(R.string.prem_t3),
    )
    Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items.forEach { (icon, text) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = Violet, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(text, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun Faq() {
    val qs = listOf(
        stringResource(R.string.prem_q1) to stringResource(R.string.prem_a1),
        stringResource(R.string.prem_q2) to stringResource(R.string.prem_a2),
        stringResource(R.string.prem_q3) to stringResource(R.string.prem_a3),
    )
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 28.dp)) {
        Text(stringResource(R.string.prem_faq), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
        qs.forEach { (q, a) ->
            var open by remember { mutableStateOf(false) }
            val rot by animateFloatAsState(if (open) 180f else 0f, label = "rot")
            Surface(Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(16.dp)).clickable { open = !open },
                shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(q, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Icon(Icons.Outlined.ExpandMore, null, modifier = Modifier.rotate(rot))
                    }
                    AnimatedVisibility(open, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                        Text(a, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/** Barre fixe en bas : offre choisie et grand bouton dégradé avec reflet (ou « Premium actif »). */
@Composable
private fun SubscribeBar(modifier: Modifier, plan: Plan?, isPremium: Boolean, premiumUntil: String?, onClick: () -> Unit) {
    val t = rememberInfiniteTransition(label = "cta")
    val shine by t.animateFloat(-0.5f, 1.5f, infiniteRepeatable(tween(2400, delayMillis = 1200, easing = FastOutSlowInEasing)), label = "shine")
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), tonalElevation = 6.dp, shadowElevation = 18.dp,
        color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp)) {
            if (isPremium) {
                Text(stringResource(R.string.prem_active), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                premiumUntil?.let { Text(stringResource(R.string.premium_until, it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                return@Column
            }
            if (plan != null) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(money(plan.price), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.width(6.dp))
                    Text(plan.per, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 3.dp))
                }
                Spacer(Modifier.height(10.dp))
            }
            Box(
                Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(18.dp))
                    .drawWithContent {
                        val w = size.width
                        drawRect(Brush.horizontalGradient(listOf(Indigo, Violet, Coral)))
                        drawContent()
                        drawRect(Brush.linearGradient(listOf(Color.Transparent, Color.White.copy(alpha = 0.35f), Color.Transparent), Offset(w * shine - w * 0.2f, 0f), Offset(w * shine + w * 0.2f, size.height)))
                    }
                    .clickable(onClick = onClick),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.prem_cta), color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.width(8.dp))
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, tint = Color.White)
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.prem_cta_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}
