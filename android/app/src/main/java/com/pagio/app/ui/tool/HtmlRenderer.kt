package com.pagio.app.ui.tool

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.pdf.PdfDocument
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume

/**
 * HTML → PDF avec le moteur web du système (WebView) : le rendu est vectoriel (texte
 * sélectionnable) et paginé au format A4. Les fichiers locaux fonctionnent hors ligne ;
 * une adresse web nécessite Internet.
 */
object HtmlRenderer {
    private const val PAGE_W_PT = 595
    private const val PAGE_H_PT = 842
    private const val VIEW_W_PX = 1240 // largeur de rendu (~150 ppp sur A4)

    @SuppressLint("SetJavaScriptEnabled")
    suspend fun render(context: Context, source: File?, url: String?, output: File, marginPt: Int = 28, onProgress: (Float, String) -> Unit): File =
        withContext(Dispatchers.Main) {
            WebView.enableSlowWholeDocumentDraw()
            val web = WebView(context)
            web.settings.javaScriptEnabled = true
            web.settings.allowFileAccess = source != null
            web.settings.loadWithOverviewMode = false
            web.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
            web.setBackgroundColor(android.graphics.Color.WHITE)
            onProgress(0.1f, "Chargement de la page…")
            suspendCancellableCoroutine { cont ->
                web.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView?, u: String?) { if (cont.isActive) cont.resume(Unit) }
                }
                if (source != null) web.loadUrl(android.net.Uri.fromFile(source).toString())
                else web.loadUrl(if (url!!.startsWith("http")) url else "https://$url")
                cont.invokeOnCancellation { web.stopLoading() }
            }
            delay(800) // laisse le temps aux polices et images de s'afficher
            onProgress(0.4f, "Mise en page…")
            val contentW = VIEW_W_PX
            web.measure(View.MeasureSpec.makeMeasureSpec(contentW, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            web.layout(0, 0, contentW, web.measuredHeight)
            delay(300)
            web.measure(View.MeasureSpec.makeMeasureSpec(contentW, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            val totalH = maxOf(web.measuredHeight, (web.contentHeight * context.resources.displayMetrics.density).toInt(), 1)
            web.layout(0, 0, contentW, totalH)
            val scale = (PAGE_W_PT - 2f * marginPt) / contentW
            val pageContentPx = ((PAGE_H_PT - 2f * marginPt) / scale).toInt()
            val pages = (totalH + pageContentPx - 1) / pageContentPx
            val pdf = PdfDocument()
            try {
                for (i in 0 until pages.coerceIn(1, 500)) {
                    onProgress(0.4f + 0.55f * i / pages, "Page ${i + 1}/$pages")
                    val page = pdf.startPage(PdfDocument.PageInfo.Builder(PAGE_W_PT, PAGE_H_PT, i + 1).create())
                    val canvas = page.canvas
                    canvas.translate(marginPt.toFloat(), marginPt.toFloat())
                    canvas.clipRect(0f, 0f, PAGE_W_PT - 2f * marginPt, PAGE_H_PT - 2f * marginPt)
                    canvas.scale(scale, scale)
                    canvas.translate(0f, -(i * pageContentPx).toFloat())
                    web.draw(canvas)
                    pdf.finishPage(page)
                }
                withContext(Dispatchers.IO) { FileOutputStream(output).use { pdf.writeTo(it) } }
            } finally {
                pdf.close(); web.destroy()
            }
            output
        }
}
