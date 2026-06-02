package app.stremio.profileloader

import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * The `AndroidBridge` object exposed to the picker WebView. Network/login work
 * happens in JavaScript (shared/stremio-api.js, via the WebView's fetch); these
 * native methods only handle storage and launching, so they're all synchronous.
 *
 * See MainActivity.BRIDGE_JS for the window.LoaderBridge wrapper that calls these.
 */
class LoaderBridge(
    private val activity: Activity,
    private val store: ProfileStore,
) {
    @JavascriptInterface
    fun listProfiles(): String = store.listJson()

    @JavascriptInterface
    fun deleteProfile(id: String) {
        store.remove(id)
    }

    @JavascriptInterface
    fun updateProfile(id: String, label: String, icon: String?) {
        store.update(id, label.trim(), icon)
    }

    /** Persist a profile after the WebView completed the login. Returns the public JSON. */
    @JavascriptInterface
    fun saveProfile(label: String, email: String, authKey: String, userJson: String, icon: String?): String {
        val user = try { JSONObject(userJson) } catch (e: Exception) { JSONObject() }
        val created = store.add(label.trim(), email.trim(), authKey, user, icon)
        return JSONObject().apply {
            put("id", created.optString("id"))
            put("label", created.optString("label"))
            put("email", created.optString("email"))
            put("avatar", created.opt("avatar") ?: JSONObject.NULL)
            put("icon", created.opt("icon") ?: JSONObject.NULL)
        }.toString()
    }

    /** authKey for a profile, so the WebView can build the session for launch. */
    @JavascriptInterface
    fun getAuthKey(id: String): String? = store.get(id)?.optString("authKey")

    /** Open Stremio Web with the (already built) profile seed. */
    @JavascriptInterface
    fun launch(id: String, profileJson: String) {
        activity.runOnUiThread {
            val intent = Intent(activity, StremioActivity::class.java)
            intent.putExtra(StremioActivity.EXTRA_PROFILE_JSON, profileJson)
            intent.putExtra(StremioActivity.EXTRA_PROFILE_ID, id)
            activity.startActivity(intent)
        }
    }
}
