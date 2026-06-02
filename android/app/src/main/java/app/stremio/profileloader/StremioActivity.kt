package app.stremio.profileloader

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView

/**
 * Loads Stremio Web with the chosen profile's session pre-seeded into
 * localStorage, so it boots already signed in. A floating "switch profile"
 * button returns to the picker (Stremio itself has no profile switching, and
 * system Back navigates Stremio's own history first).
 */
class StremioActivity : Activity() {

    private lateinit var webView: WebView
    private var seeded = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val profileJson = intent.getStringExtra(EXTRA_PROFILE_JSON)
        if (profileJson.isNullOrBlank()) { finish(); return }

        val root = FrameLayout(this)
        webView = WebView(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )

        // Floating "switch profile" button -> back to the picker.
        val switchBtn = ImageButton(this).apply {
            setImageResource(R.drawable.ic_switch)
            setBackgroundResource(R.drawable.switch_bg)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(10), dp(10), dp(10), dp(10))
            contentDescription = "Switch profile"
            setOnClickListener { finish() }
        }
        val size = dp(46)
        root.addView(switchBtn, FrameLayout.LayoutParams(size, size).apply {
            gravity = Gravity.TOP or Gravity.START
            setMargins(dp(12), dp(12), 0, 0)
        })

        setContentView(root)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
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

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

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
