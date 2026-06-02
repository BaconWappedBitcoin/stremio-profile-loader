package app.stremio.profileloader

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.util.Base64
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Loads Stremio Web with the chosen profile's session pre-seeded into
 * localStorage, so it boots already signed in.
 *
 * Seeding strategy: on the first page load we write `profile` + `schema_version`
 * to localStorage and reload once. On the reloaded page the session is present
 * before stremio-core runs, so it deserializes an authenticated profile.
 */
class StremioActivity : Activity() {

    private lateinit var webView: WebView
    private var seeded = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val profileJson = intent.getStringExtra(EXTRA_PROFILE_JSON)
        if (profileJson.isNullOrBlank()) { finish(); return }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // A desktop-ish UA gives the full Stremio Web experience on tablets/TV.
            userAgentString = userAgentString + " StremioProfileLoader"
        }
        webView.webChromeClient = WebChromeClient()

        val seedJs = buildSeedJs(profileJson)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                if (!seeded) {
                    seeded = true
                    view.evaluateJavascript(seedJs, null)
                }
            }
        }

        webView.loadUrl(STREMIO_WEB_URL)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun buildSeedJs(profileJson: String): String {
        val b64 = Base64.encodeToString(profileJson.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        return """
        (function () {
          try {
            var bytes = Uint8Array.from(atob('$b64'), function (c) { return c.charCodeAt(0); });
            var json = new TextDecoder('utf-8').decode(bytes);
            localStorage.setItem('profile', json);
            localStorage.setItem('schema_version', '${StremioApi.SCHEMA_VERSION}');
            location.reload();
          } catch (e) { console.error('[stremio-profile-loader] seed failed', e); }
        })();
        """.trimIndent()
    }

    companion object {
        const val EXTRA_PROFILE_JSON = "profile_json"
        private const val STREMIO_WEB_URL = "https://web.stremio.com/"
    }
}
