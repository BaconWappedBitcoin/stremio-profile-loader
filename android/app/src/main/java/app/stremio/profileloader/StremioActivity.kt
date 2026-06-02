package app.stremio.profileloader

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.Base64
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
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
    private var currentId: String? = null
    private var seeded = false

    private val avatarColors = intArrayOf(
        0xFF7B5BF5.toInt(), 0xFF0D9488.toInt(), 0xFFE11D48.toInt(), 0xFFF59E0B.toInt(),
        0xFF2563EB.toInt(), 0xFF16A34A.toInt(), 0xFFDB2777.toInt(), 0xFF7C3AED.toInt(),
    )

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val profileJson = intent.getStringExtra(EXTRA_PROFILE_JSON)
        if (profileJson.isNullOrBlank()) { finish(); return }
        currentId = intent.getStringExtra(EXTRA_PROFILE_ID)

        store = ProfileStore(this)
        stremioApiJs = assets.open("picker/stremio-api.js").bufferedReader().use { it.readText() }

        val rootCol = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        rootCol.addView(buildTopBar(), LinearLayout.LayoutParams(MATCH, dp(52)))

        webView = WebView(this)
        rootCol.addView(webView, LinearLayout.LayoutParams(MATCH, 0, 1f))
        setContentView(rootCol)

        updateChip()

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
                view.evaluateJavascript(stremioApiJs, null)
            }
            override fun onPageFinished(view: WebView, url: String?) {
                if (!seeded) { seeded = true; view.evaluateJavascript(seedJs, null) }
            }
        }
        webView.loadUrl(STREMIO_WEB_URL)
    }

    // ---- Top bar ----
    private fun buildTopBar(): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF11111F.toInt())
            setPadding(dp(14), 0, dp(10), 0)
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
        chipAvatar = makeAvatar("?", avatarColors[0], 30)
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
        styleAvatar(chipAvatar, label, colorFor(currentId ?: label))
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
        row.addView(makeAvatar(initial(label), colorFor(id), 36).also { styleAvatar(it, label, colorFor(id)) },
            LinearLayout.LayoutParams(dp(36), dp(36)))
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
          } catch (e) { console.error('[strloader] switch failed', e); }
        })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    // ---- helpers ----
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun toast(m: String) = android.widget.Toast.makeText(this, m, android.widget.Toast.LENGTH_SHORT).show()
    private fun initial(label: String): String = label.trim().ifEmpty { "?" }.substring(0, 1).uppercase()
    private fun colorFor(key: String): Int = avatarColors[Math.floorMod(key.hashCode(), avatarColors.size)]

    private fun makeAvatar(initial: String, color: Int, sizeDp: Int): TextView = TextView(this).apply {
        text = initial
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        setTextSize(TypedValue.COMPLEX_UNIT_SP, (sizeDp / 2.4f))
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
    }

    private fun styleAvatar(tv: TextView, label: String, color: Int) {
        tv.text = initial(label)
        (tv.background as? GradientDrawable)?.setColor(color)
            ?: run { tv.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) } }
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
        const val EXTRA_PROFILE_JSON = "profile_json"
        const val EXTRA_PROFILE_ID = "profile_id"
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val STREMIO_WEB_URL = "https://web.stremio.com/"
    }
}
