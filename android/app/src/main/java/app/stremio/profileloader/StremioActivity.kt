package app.stremio.profileloader

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.view.Menu
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.PopupMenu
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject

/**
 * Loads Stremio Web with the chosen profile's session pre-seeded into
 * localStorage, so it boots already signed in. The floating button opens a
 * profile menu: picking another profile re-seeds and reloads in place (no trip
 * back to the picker); "Manage profiles…" returns to the picker.
 */
class StremioActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var store: ProfileStore
    private lateinit var stremioApiJs: String
    private var currentId: String? = null
    private var seeded = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val profileJson = intent.getStringExtra(EXTRA_PROFILE_JSON)
        if (profileJson.isNullOrBlank()) { finish(); return }
        currentId = intent.getStringExtra(EXTRA_PROFILE_ID)

        store = ProfileStore(this)
        stremioApiJs = assets.open("picker/stremio-api.js").bufferedReader().use { it.readText() }

        val root = FrameLayout(this)
        webView = WebView(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )

        val switchBtn = ImageButton(this).apply {
            setImageResource(R.drawable.ic_switch)
            setBackgroundResource(R.drawable.switch_bg)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(10), dp(10), dp(10), dp(10))
            contentDescription = "Switch profile"
            setOnClickListener { showProfileMenu(this) }
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
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                // Make window.StremioApi available so in-place switching can build
                // a new session via the WebView's fetch.
                view.evaluateJavascript(stremioApiJs, null)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!seeded) {
                    seeded = true
                    view.evaluateJavascript(seedJs, null)
                }
            }
        }

        webView.loadUrl(STREMIO_WEB_URL)
    }

    /** Dropdown of profiles + "Manage profiles…". */
    private fun showProfileMenu(anchor: android.view.View) {
        val profiles = JSONArray(store.listJson())
        val popup = PopupMenu(this, anchor)
        for (i in 0 until profiles.length()) {
            val p = profiles.getJSONObject(i)
            val label = p.optString("label")
            val isCurrent = p.optString("id") == currentId
            popup.menu.add(Menu.NONE, i, i, if (isCurrent) "$label  ✓" else label)
        }
        popup.menu.add(Menu.NONE, MANAGE_ID, profiles.length(), "Manage profiles…")
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                MANAGE_ID -> { finish(); true }
                else -> {
                    val p = profiles.getJSONObject(item.itemId)
                    val id = p.optString("id")
                    if (id != currentId) switchTo(id, p.optString("label"))
                    true
                }
            }
        }
        popup.show()
    }

    /** Rebuild the session for [profileId] in the WebView and reload in place. */
    private fun switchTo(profileId: String, label: String) {
        val authKey = store.get(profileId)?.optString("authKey")
        if (authKey.isNullOrEmpty()) {
            Toast.makeText(this, "That profile is missing its login.", Toast.LENGTH_SHORT).show()
            return
        }
        currentId = profileId
        Toast.makeText(this, "Switching to $label…", Toast.LENGTH_SHORT).show()
        val ak = JSONObject.quote(authKey)
        val js = """
        (async function () {
          try {
            if (!window.StremioApi) { location.reload(); return; }
            var p = await window.StremioApi.buildProfile($ak);
            if (p && p.settings) {
              var d = new Date(); d.setFullYear(d.getFullYear() + 50);
              p.settings.streamingServerWarningDismissed = d.toISOString();
            }
            localStorage.setItem('profile', JSON.stringify(p));
            localStorage.setItem('schema_version', '${StremioApi.SCHEMA_VERSION}');
            location.reload();
          } catch (e) { console.error('[strloader] switch failed', e); }
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
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
        const val EXTRA_PROFILE_ID = "profile_id"
        private const val MANAGE_ID = 100000
        private const val STREMIO_WEB_URL = "https://web.stremio.com/"
    }
}
