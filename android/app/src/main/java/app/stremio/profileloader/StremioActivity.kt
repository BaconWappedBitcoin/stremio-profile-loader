package app.stremio.profileloader

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Loads Stremio Web with the chosen profile's session pre-seeded into
 * localStorage. A slim top bar shows the current profile (avatar + name); tapping
 * it opens a Netflix-style selector to switch profiles in place. "Manage
 * profiles…" returns to the picker.
 */
class StremioActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var store: ProfileStore
    private lateinit var stremioApiJs: String
    private lateinit var chipAvatar: TextView
    private lateinit var chipName: TextView
    private lateinit var topBar: View
    private lateinit var rootCol: LinearLayout
    private lateinit var decorRoot: FrameLayout
    private var currentId: String? = null
    private var seeded = false

    // Fullscreen-landscape state. Triggered when Stremio enters the player view
    // (route-based, see PLAYER_WATCH_JS) or, as a fallback, on an HTML5
    // fullscreen request (onShowCustomView).
    private var fsActive = false
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var savedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val profileJson = intent.getStringExtra(EXTRA_PROFILE_JSON)
        if (profileJson.isNullOrBlank()) { finish(); return }
        currentId = intent.getStringExtra(EXTRA_PROFILE_ID)

        WebView.setWebContentsDebuggingEnabled(true)
        store = ProfileStore(this)
        stremioApiJs = assets.open("picker/stremio-api.js").bufferedReader().use { it.readText() }

        rootCol = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        topBar = buildTopBar()
        rootCol.addView(topBar, LinearLayout.LayoutParams(MATCH, ViewGroup.LayoutParams.WRAP_CONTENT))

        webView = WebView(this)
        rootCol.addView(webView, LinearLayout.LayoutParams(MATCH, 0, 1f))

        // Wrap in a FrameLayout so fullscreen video can be overlaid on top.
        decorRoot = FrameLayout(this)
        decorRoot.addView(rootCol, FrameLayout.LayoutParams(MATCH, MATCH))
        setContentView(decorRoot)

        // Android 15+ draws edge-to-edge; pad the top bar below the status bar so
        // it (and the profile chip) don't sit under the clock/battery.
        val baseTopPad = topBar.paddingTop
        decorRoot.setOnApplyWindowInsetsListener { _, insets ->
            val statusTop = if (Build.VERSION.SDK_INT >= 30)
                insets.getInsets(WindowInsets.Type.statusBars()).top
            else @Suppress("DEPRECATION") insets.systemWindowInsetTop
            topBar.setPadding(topBar.paddingLeft, baseTopPad + statusTop, topBar.paddingRight, topBar.paddingBottom)
            insets
        }

        updateChip()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = userAgentString + " StremioProfileLoader"
        }

        // Handle the player's fullscreen request: show the video full-screen in
        // landscape (the native app rotates to widescreen; a plain WebChromeClient
        // would leave it inline/portrait).
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) { onHideCustomView(); return }
                customView = view
                customViewCallback = callback
                rootCol.visibility = View.GONE
                view.setBackgroundColor(Color.BLACK)
                decorRoot.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
                enterFullscreen()
            }

            override fun onHideCustomView() { hideCustomView() }
        }

        // Lets the injected watcher tell us when Stremio is on the player view.
        webView.addJavascriptInterface(PlayerBridge(), "AndroidPlayer")

        val seedJs = buildSeedJs(profileJson)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                view.evaluateJavascript(stremioApiJs, null)
            }
            override fun onPageFinished(view: WebView, url: String?) {
                if (!seeded) { seeded = true; view.evaluateJavascript(seedJs, null) }
                view.evaluateJavascript(PLAYER_WATCH_JS, null)
            }
        }
        webView.loadUrl(STREMIO_WEB_URL)

        // API 33+ routes Back through OnBackInvokedCallback (onBackPressed isn't
        // called), so register one to drive our route-based Back handling.
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { handleBack() }
        }
    }

    // ---- Top bar ----
    private fun buildTopBar(): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF11111F.toInt())
            setPadding(dp(14), dp(8), dp(10), dp(8))
        }
        val brand = TextView(this).apply {
            text = "STRLoader"
            setTextColor(0xFFB9A9FF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        bar.addView(brand, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        // Profile chip: avatar + name + caret
        val chip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = pill(0x22FFFFFF)
            setPadding(dp(6), dp(5), dp(10), dp(5))
            isClickable = true
            setOnClickListener { showSelector(this) }
        }
        chipAvatar = makeAvatar("?", 30)
        chip.addView(chipAvatar, LinearLayout.LayoutParams(dp(30), dp(30)))
        chipName = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(dp(8), 0, dp(6), 0)
            maxWidth = dp(120)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        chip.addView(chipName)
        val caret = TextView(this).apply {
            text = "▾"; setTextColor(0xFFA9A9C7.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        }
        chip.addView(caret)
        bar.addView(chip)
        return bar
    }

    private fun updateChip() {
        val p = currentId?.let { store.get(it) }
        val label = p?.optString("label") ?: "Profile"
        chipName.text = label
        styleAvatar(chipAvatar, label)
    }

    // ---- Selector ----
    private fun showSelector(anchor: View) {
        val profiles = JSONArray(store.listJson())
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = card(0xFF16162A.toInt())
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }
        val scroll = ScrollView(this).apply { addView(panel) }
        val popup = PopupWindow(scroll, dp(260), ViewGroup.LayoutParams.WRAP_CONTENT, true).apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            isOutsideTouchable = true
            elevation = dp(10).toFloat()
        }

        for (i in 0 until profiles.length()) {
            val prof = profiles.getJSONObject(i)
            val id = prof.optString("id")
            val label = prof.optString("label")
            val isCurrent = id == currentId
            panel.addView(profileRow(label, id, isCurrent) {
                popup.dismiss()
                if (!isCurrent) switchTo(id, label)
            })
        }
        // divider + manage
        panel.addView(View(this).apply { setBackgroundColor(0x22FFFFFF); }, LinearLayout.LayoutParams(MATCH, dp(1)).apply { setMargins(dp(8), dp(6), dp(8), dp(6)) })
        panel.addView(simpleRow("Manage profiles…") { popup.dismiss(); finish() })

        popup.showAsDropDown(anchor, 0, dp(6))
    }

    private fun profileRow(label: String, id: String, current: Boolean, onClick: () -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(10), dp(12), dp(10))
            if (current) background = pill(0x22FFFFFF)
            isClickable = true
            setOnClickListener { onClick() }
        }
        row.addView(makeAvatar(initial(label), 36), LinearLayout.LayoutParams(dp(36), dp(36)))
        val name = TextView(this).apply {
            text = if (current) "$label" else label
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding(dp(12), 0, 0, 0)
        }
        row.addView(name, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (current) {
            row.addView(TextView(this).apply { text = "✓"; setTextColor(0xFF8E72FF.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f) })
        }
        return row
    }

    private fun simpleRow(text: String, onClick: () -> Unit): View = TextView(this).apply {
        this.text = text
        setTextColor(0xFFA9A9C7.toInt())
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setPadding(dp(14), dp(12), dp(12), dp(12))
        isClickable = true
        setOnClickListener { onClick() }
    }

    // ---- Switching ----
    private fun switchTo(profileId: String, label: String) {
        val authKey = store.get(profileId)?.optString("authKey")
        if (authKey.isNullOrEmpty()) {
            toast("That profile is missing its login.")
            return
        }
        currentId = profileId
        updateChip()
        toast("Switching to $label…")
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
          } catch (e) {
            console.error('[strloader] switch failed', e);
            try { AndroidPlayer.toast('Switch failed. Check your connection.'); } catch (_) {}
          }
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    // API < 33 dispatches Back here; API 33+ uses the OnBackInvokedCallback
    // registered in onCreate (legacy onBackPressed isn't called there).
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { handleBack() }

    /**
     * Stremio is an SPA, so WebView.canGoBack() is unreliable. Decide by route:
     * on the player (or any inner page) Back goes to Stremio's home; only when
     * already at home does Back leave (to the picker). Leaving the player route
     * lets the watcher restore portrait.
     */
    private fun handleBack() {
        Log.d(TAG, "handleBack customView=${customView != null}")
        if (customView != null) { hideCustomView(); return }
        if (!this::webView.isInitialized) { finish(); return }
        webView.evaluateJavascript("(location.hash||'')") { raw ->
            val hash = (raw ?: "").trim('"')
            val atHome = hash.isEmpty() || hash == "#" || hash == "#/" || hash.contains("/board")
            Log.d(TAG, "back: hash=$hash atHome=$atHome -> ${if (atHome) "finish" else "goBoard"}")
            runOnUiThread {
                if (atHome) finish()
                else webView.evaluateJavascript("location.hash='#/board';", null)
            }
        }
    }

    private fun hideCustomView() {
        val v = customView ?: return
        decorRoot.removeView(v)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        rootCol.visibility = View.VISIBLE
        exitFullscreen()
    }

    /** Force landscape + immersive + hide our top bar (widescreen playback). */
    private fun enterFullscreen() {
        if (fsActive) return
        fsActive = true
        savedOrientation = requestedOrientation
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        topBar.visibility = View.GONE
        setFullscreenUi(true)
    }

    private fun exitFullscreen() {
        if (!fsActive) return
        fsActive = false
        requestedOrientation = savedOrientation
        topBar.visibility = View.VISIBLE
        setFullscreenUi(false)
    }

    /** JS bridge: player-view watcher + toast feedback. */
    inner class PlayerBridge {
        @JavascriptInterface
        fun enter() { runOnUiThread { enterFullscreen() } }

        @JavascriptInterface
        fun exit() { runOnUiThread { exitFullscreen() } }

        @JavascriptInterface
        fun toast(msg: String) { runOnUiThread { toast(msg) } }
    }

    @Suppress("DEPRECATION")
    private fun setFullscreenUi(on: Boolean) {
        if (on) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
        }
    }

    // ---- helpers ----
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun toast(m: String) = android.widget.Toast.makeText(this, m, android.widget.Toast.LENGTH_SHORT).show()
    private fun initial(label: String): String = label.trim().ifEmpty { "?" }.substring(0, 1).uppercase()

    // The picker's avatar look: purple accent gradient.
    private fun avatarDrawable(): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFF7B5BF5.toInt(), 0xFF4A2FB0.toInt())
    ).apply { shape = GradientDrawable.OVAL }

    private fun makeAvatar(initial: String, sizeDp: Int): TextView = TextView(this).apply {
        text = initial
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        setTextSize(TypedValue.COMPLEX_UNIT_SP, (sizeDp / 2.4f))
        background = avatarDrawable()
    }

    private fun styleAvatar(tv: TextView, label: String) {
        tv.text = initial(label)
        if (tv.background !is GradientDrawable) tv.background = avatarDrawable()
    }

    private fun pill(color: Int): GradientDrawable =
        GradientDrawable().apply { shape = GradientDrawable.RECTANGLE; cornerRadius = dp(20).toFloat(); setColor(color) }

    private fun card(color: Int): GradientDrawable =
        GradientDrawable().apply { shape = GradientDrawable.RECTANGLE; cornerRadius = dp(14).toFloat(); setColor(color); setStroke(dp(1), 0xFF2A2A44.toInt()) }

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
        private const val TAG = "STRLoaderBack"
        const val EXTRA_PROFILE_JSON = "profile_json"
        const val EXTRA_PROFILE_ID = "profile_id"
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val STREMIO_WEB_URL = "https://web.stremio.com/"

        /**
         * Watches Stremio's hash route and tells the activity to go
         * landscape/immersive while on the player view (Stremio Web renders the
         * player in-page and never asks for HTML5 fullscreen, so we drive
         * orientation ourselves). Reinstalls itself per document.
         */
        private const val PLAYER_WATCH_JS = """
        (function () {
          if (window.__strloaderPlayerWatch) return;
          window.__strloaderPlayerWatch = true;
          function onPlayer() { return (location.hash || '').indexOf('/player') !== -1; }
          var last = null;
          function tick() {
            var p = onPlayer();
            if (p !== last) {
              last = p;
              try { if (p) AndroidPlayer.enter(); else AndroidPlayer.exit(); } catch (e) {}
            }
          }
          window.addEventListener('hashchange', tick);
          setInterval(tick, 500);
          setTimeout(tick, 300);
        })();
        """
    }
}
