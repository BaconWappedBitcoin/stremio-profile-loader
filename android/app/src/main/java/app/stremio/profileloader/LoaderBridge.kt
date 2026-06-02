package app.stremio.profileloader

import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The `AndroidBridge` object exposed to the picker WebView. The injected
 * bridge-android.js (see MainActivity.BRIDGE_JS) wraps these methods into the
 * async `window.LoaderBridge` API the shared picker UI expects.
 *
 * Sync methods return immediately; async ones do their work off the main thread
 * and settle the JS promise via window.__bridgeSettle(id, ok, payloadJson).
 */
class LoaderBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val store: ProfileStore,
) {
    private val io = Executors.newSingleThreadExecutor()

    @JavascriptInterface
    fun listProfiles(): String = store.listJson()

    @JavascriptInterface
    fun updateProfile(id: String, label: String, icon: String?) {
        store.update(id, label.trim(), icon)
    }

    @JavascriptInterface
    fun deleteProfile(id: String) {
        store.remove(id)
    }

    @JavascriptInterface
    fun addProfile(callbackId: String, label: String, email: String, password: String, icon: String?) {
        io.execute {
            try {
                if (label.isBlank() || email.isBlank() || password.isBlank()) {
                    throw StremioApi.ApiException("Please fill in the profile name, email and password.")
                }
                val (authKey, user) = StremioApi.login(email.trim(), password)
                val created = store.add(label.trim(), email.trim(), authKey, user, icon)
                val publicJson = JSONObject().apply {
                    put("id", created.optString("id"))
                    put("label", created.optString("label"))
                    put("email", created.optString("email"))
                    put("avatar", created.opt("avatar") ?: JSONObject.NULL)
                    put("icon", created.opt("icon") ?: JSONObject.NULL)
                }
                settle(callbackId, true, publicJson.toString())
            } catch (e: Exception) {
                settle(callbackId, false, e.message ?: "Sign in failed.")
            }
        }
    }

    @JavascriptInterface
    fun launch(callbackId: String, profileId: String) {
        io.execute {
            try {
                val profile = store.get(profileId)
                    ?: throw StremioApi.ApiException("Profile not found.")
                val authKey = profile.optString("authKey")

                val seed: JSONObject = try {
                    StremioApi.buildProfile(authKey)
                } catch (e: StremioApi.ApiException) {
                    throw StremioApi.ApiException(
                        "This profile's Stremio session has expired. Remove it and add it again."
                    )
                }
                // Refresh cached user from the freshly validated session.
                seed.optJSONObject("auth")?.optJSONObject("user")?.let { store.updateUser(profileId, it) }

                activity.runOnUiThread {
                    val intent = Intent(activity, StremioActivity::class.java)
                    intent.putExtra(StremioActivity.EXTRA_PROFILE_JSON, seed.toString())
                    activity.startActivity(intent)
                }
                settle(callbackId, true, "null")
            } catch (e: Exception) {
                settle(callbackId, false, e.message ?: "Could not launch profile.")
            }
        }
    }

    private fun settle(callbackId: String, ok: Boolean, payload: String) {
        val quoted = JSONObject.quote(payload)
        webView.post {
            webView.evaluateJavascript(
                "window.__bridgeSettle && window.__bridgeSettle(\"$callbackId\", $ok, $quoted);",
                null
            )
        }
    }
}
