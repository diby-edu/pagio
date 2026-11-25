package com.pagio.app.ui.intro

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pagio.app.R
import kotlinx.coroutines.launch

private val BRAND = Brush.linearGradient(listOf(Color(0xFF4535C9), Color(0xFF7A5CF0), Color(0xFFFF7A66)))

/**
 * Animation du logo à chaque ouverture (moins d'une seconde) : le logo apparaît en grandissant sur le dégradé de
 * Pagio, puis l'écran s'efface. Respecte le réglage « animations réduites » d'Android (durées système).
 */
@Composable
fun SplashOverlay(onDone: () -> Unit) {
    val scale = remember { Animatable(0.6f) }
    val alpha = remember { Animatable(1f) }
    val logo = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        launch { logo.animateTo(1f, tween(320)) }
        scale.animateTo(1f, tween(420, easing = FastOutSlowInEasing))
        alpha.animateTo(0f, tween(260, delayMillis = 120))
        onDone()
    }
    Box(Modifier.fillMaxSize().alpha(alpha.value).background(BRAND), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(112.dp).scale(scale.value).alpha(logo.value).clip(RoundedCornerShape(30.dp)).background(Color.White), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.ic_launcher_foreground), null, Modifier.size(150.dp))
            }
            Spacer(Modifier.height(18.dp))
            Text("Pagio", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.alpha(logo.value))
        }
    }
}

private data class Slide(val icon: ImageVector, val title: Int, val text: Int)

private val SLIDES = listOf(
    Slide(Icons.Outlined.PictureAsPdf, R.string.intro1_t, R.string.intro1_d),
    Slide(Icons.Outlined.DocumentScanner, R.string.intro2_t, R.string.intro2_d),
    Slide(Icons.Outlined.Lock, R.string.intro3_t, R.string.intro3_d),
    Slide(Icons.Outlined.AutoAwesome, R.string.intro4_t, R.string.intro4_d),
)

/** Écrans de présentation, au tout premier lancement seulement (« Passer » à tout moment). */
@Composable
fun Onboarding(onFinish: (skipped: Boolean) -> Unit) {
    val pager = rememberPagerState { SLIDES.size }
    val scope = rememberCoroutineScope()
    val last = pager.currentPage == SLIDES.lastIndex
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.End) {
            if (!last) TextButton(onClick = { onFinish(true) }) { Text(stringResource(R.string.intro_skip)) }
            else Spacer(Modifier.height(48.dp))
        }
        HorizontalPager(pager, Modifier.weight(1f)) { i ->
            val s = SLIDES[i]
            Column(Modifier.fillMaxSize().padding(horizontal = 32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(132.dp).clip(CircleShape).background(BRAND), contentAlignment = Alignment.Center) {
                    Icon(s.icon, null, Modifier.size(64.dp), tint = Color.White)
                }
                Spacer(Modifier.height(36.dp))
                Text(stringResource(s.title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                Spacer(Modifier.height(14.dp))
                Text(stringResource(s.text), style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        val pageLabel = stringResource(R.string.intro_page, pager.currentPage + 1, SLIDES.size)
        Row(Modifier.fillMaxWidth().padding(vertical = 16.dp).semantics { contentDescription = pageLabel }, horizontalArrangement = Arrangement.Center) {
            SLIDES.indices.forEach { i ->
                Box(Modifier.padding(4.dp).height(8.dp).width(if (i == pager.currentPage) 24.dp else 8.dp).clip(CircleShape)
                    .background(if (i == pager.currentPage) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant))
            }
        }
        Button(onClick = { if (last) onFinish(false) else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp).height(52.dp)) {
            Text(stringResource(if (last) R.string.intro_start else R.string.next))
        }
    }
}

/** Mémoire « présentation déjà vue » (indépendante des réglages : jamais remise à zéro par une mise à jour). */
object IntroPrefs {
    private fun p(c: Context) = c.getSharedPreferences("pagio-intro", Context.MODE_PRIVATE)
    fun seen(c: Context) = p(c).getBoolean("seen", false)
    fun markSeen(c: Context) = p(c).edit().putBoolean("seen", true).apply()
}
