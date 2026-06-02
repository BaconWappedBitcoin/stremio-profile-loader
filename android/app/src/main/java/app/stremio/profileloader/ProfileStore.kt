package app.stremio.profileloader

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Persists profiles in SharedPreferences as a JSON array. Stores only a
 * revocable Stremio authKey (plus cached user + display label) — never passwords.
 */
class ProfileStore(context: Context) {

    private val prefs = context.getSharedPreferences("profiles", Context.MODE_PRIVATE)

    private fun readAll(): JSONArray =
        JSONArray(prefs.getString(KEY, "[]") ?: "[]")

    private fun writeAll(arr: JSONArray) {
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    /** Public, token-free view for the WebView UI (JSON string). */
    fun listJson(): String {
        val all = readAll()
        val out = JSONArray()
        for (i in 0 until all.length()) {
            val p = all.getJSONObject(i)
            out.put(JSONObject().apply {
                put("id", p.optString("id"))
                put("label", p.optString("label"))
                put("email", p.optString("email"))
                put("avatar", p.opt("avatar") ?: JSONObject.NULL)
                put("icon", p.opt("icon") ?: JSONObject.NULL)
            })
        }
        return out.toString()
    }

    fun get(id: String): JSONObject? {
        val all = readAll()
        for (i in 0 until all.length()) {
            val p = all.getJSONObject(i)
            if (p.optString("id") == id) return p
        }
        return null
    }

    fun add(label: String, email: String, authKey: String, user: JSONObject, icon: String?): JSONObject {
        val all = readAll()
        val profile = JSONObject().apply {
            put("id", UUID.randomUUID().toString())
            put("label", label)
            put("email", email)
            put("authKey", authKey)
            put("user", user)
            put("avatar", user.opt("avatar") ?: JSONObject.NULL)
            put("icon", icon ?: JSONObject.NULL)
        }
        all.put(profile)
        writeAll(all)
        return profile
    }

    fun updateUser(id: String, user: JSONObject) {
        val all = readAll()
        for (i in 0 until all.length()) {
            val p = all.getJSONObject(i)
            if (p.optString("id") == id) {
                p.put("user", user)
                p.put("avatar", user.opt("avatar") ?: JSONObject.NULL)
                writeAll(all)
                return
            }
        }
    }

    fun remove(id: String) {
        val all = readAll()
        val out = JSONArray()
        for (i in 0 until all.length()) {
            val p = all.getJSONObject(i)
            if (p.optString("id") != id) out.put(p)
        }
        writeAll(out)
    }

    companion object { private const val KEY = "list" }
}
