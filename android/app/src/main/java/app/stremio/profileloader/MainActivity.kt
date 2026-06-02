package app.stremio.profileloader

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Hosts the shared profile-picker UI (loaded from assets) in a WebView and wires
 * up the AndroidBridge -> window.LoaderBridge plumbing.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        val store = ProfileStore(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
        }
        webView.addJavascriptInterface(LoaderBridge(this, webView, store), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                // Define window.LoaderBridge before the picker's app.js polls for it.
                view.evaluateJavascript(BRIDGE_JS, null)
            }
        }

        webView.loadUrl("file:///android_asset/picker/index.html")
    }

    companion object {
        /** Wraps the synchronous AndroidBridge into the async LoaderBridge contract. */
        private const val BRIDGE_JS = """
        (function () {
          if (window.LoaderBridge && window.LoaderBridge.platform === 'android') return;
          window.__bridgePending = window.__bridgePending || {};
          window.__bridgeSeq = window.__bridgeSeq || 0;
          window.__bridgeSettle = function (id, ok, payloadJson) {
            var p = window.__bridgePending[id];
            if (!p) return;
            delete window.__bridgePending[id];
            var val;
            try { val = (payloadJson === undefined || payloadJson === null) ? null : JSON.parse(payloadJson); }
            catch (e) { val = payloadJson; }
            if (ok) p.resolve(val);
            else p.reject(new Error(typeof val === 'string' ? val : ((val && val.message) || 'Error')));
          };
          function defer(invoke) {
            return new Promise(function (resolve, reject) {
              var id = ++window.__bridgeSeq;
              window.__bridgePending[id] = { resolve: resolve, reject: reject };
              try { invoke(String(id)); }
              catch (e) { delete window.__bridgePending[id]; reject(e); }
            });
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
            addProfile: function (data) {
              return defer(function (id) { AndroidBridge.addProfile(id, data.label, data.email, data.password, data.icon || null); });
            },
            launch: function (profileId) {
              return defer(function (id) { AndroidBridge.launch(id, profileId); });
            }
          };
        })();
        """
    }
}
