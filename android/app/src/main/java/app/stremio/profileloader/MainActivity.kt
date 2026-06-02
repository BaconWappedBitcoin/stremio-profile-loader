package app.stremio.profileloader

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Hosts the shared profile-picker UI (loaded from assets) in a WebView and wires
 * up the AndroidBridge -> window.LoaderBridge plumbing. Login/API work runs in
 * the WebView itself (shared/stremio-api.js via fetch) so it uses the browser
 * network stack rather than Android's HttpURLConnection.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var stremioApiJs: String

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebView.setWebContentsDebuggingEnabled(true)
        webView = WebView(this)
        setContentView(webView)

        val store = ProfileStore(this)
        stremioApiJs = assets.open("picker/stremio-api.js").bufferedReader().use { it.readText() }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // The picker is loaded from file:// — allow it to fetch api.strem.io
            // cross-origin (the API sends Access-Control-Allow-Origin: *).
            allowUniversalAccessFromFileURLs = true
        }
        webView.addJavascriptInterface(LoaderBridge(this, store), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                // Define window.StremioApi, then window.LoaderBridge, before the
                // picker's app.js polls for the bridge.
                view.evaluateJavascript(stremioApiJs, null)
                view.evaluateJavascript(BRIDGE_JS, null)
            }
        }

        webView.loadUrl("file:///android_asset/picker/index.html")
    }

    companion object {
        /**
         * Wraps the synchronous AndroidBridge into the async LoaderBridge contract.
         * login()/buildProfile() run in the WebView via window.StremioApi (fetch);
         * the native side only stores and launches.
         */
        private const val BRIDGE_JS = """
        (function () {
          if (window.LoaderBridge && window.LoaderBridge.platform === 'android') return;
          function api() {
            if (!window.StremioApi) throw new Error('Stremio API failed to load.');
            return window.StremioApi;
          }
          window.LoaderBridge = {
            platform: 'android',
            listProfiles: function () {
              try { return Promise.resolve(JSON.parse(AndroidBridge.listProfiles())); }
              catch (e) { return Promise.reject(e); }
            },
            deleteProfile: function (id) {
              try { AndroidBridge.deleteProfile(id); return Promise.resolve(); }
              catch (e) { return Promise.reject(e); }
            },
            updateProfile: function (id, data) {
              try { AndroidBridge.updateProfile(id, data.label, data.icon || null); return Promise.resolve(); }
              catch (e) { return Promise.reject(e); }
            },
            addProfile: function (data) {
              if (!data.label || !data.email || !data.password) {
                return Promise.reject(new Error('Please fill in the profile name, email and password.'));
              }
              return api().login(data.email.trim(), data.password).then(function (r) {
                var json = AndroidBridge.saveProfile(
                  data.label.trim(), data.email.trim(), r.authKey,
                  JSON.stringify(r.user || {}), data.icon || null);
                return JSON.parse(json);
              });
            },
            launch: function (id) {
              var authKey = AndroidBridge.getAuthKey(id);
              if (!authKey) return Promise.reject(new Error('Profile not found.'));
              return api().buildProfile(authKey).then(function (profile) {
                // A WebView has no local streaming server, so pre-dismiss the
                // "Streaming server is not available" nag (debrid/HTTP addons
                // don't need it). Stremio shows it whenever this date is in the
                // past/null, and its own "Don't show again" sets now + 50 years.
                try {
                  if (profile && profile.settings) {
                    var dismiss = new Date();
                    dismiss.setFullYear(dismiss.getFullYear() + 50);
                    profile.settings.streamingServerWarningDismissed = dismiss.toISOString();
                  }
                } catch (e) {}
                AndroidBridge.launch(id, JSON.stringify(profile));
                return null;
              });
            }
          };
        })();
        """
    }
}
