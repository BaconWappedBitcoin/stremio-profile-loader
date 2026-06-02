package app.stremio.profileloader

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Kotlin port of shared/stremio-api.js. Talks to https://api.strem.io.
 *
 * The Stremio API returns HTTP 200 even on failure and signals errors via an
 * `error` object in the body, so every call checks for that.
 *
 * All methods are blocking and must be called off the main thread.
 */
object StremioApi {

    private const val API_URL = "https://api.strem.io"
    const val SCHEMA_VERSION = "22"

    class ApiException(message: String, val code: Int = -1) : Exception(message)

    private fun apiCall(method: String, body: JSONObject): JSONObject {
        val url = URL("$API_URL/api/$method")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 20000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            json.optJSONObject("error")?.let { err ->
                throw ApiException(err.optString("message", "Stremio API error"), err.optInt("code", -1))
            }
            return json.optJSONObject("result") ?: JSONObject()
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException("Network error talking to Stremio: ${e.message}")
        } finally {
            conn.disconnect()
        }
    }

    /** @return Pair(authKey, user). */
    fun login(email: String, password: String): Pair<String, JSONObject> {
        val result = apiCall(
            "login",
            JSONObject()
                .put("type", "Login")
                .put("email", email)
                .put("password", password)
                .put("facebook", false)
        )
        val authKey = result.optString("authKey", "")
        if (authKey.isEmpty()) throw ApiException("Login succeeded but no authKey was returned")
        return Pair(authKey, result.optJSONObject("user") ?: JSONObject())
    }

    fun getUser(authKey: String): JSONObject =
        apiCall("getUser", JSONObject().put("type", "GetUser").put("authKey", authKey))

    fun getAddonCollection(authKey: String): JSONArray {
        val result = apiCall(
            "addonCollectionGet",
            JSONObject().put("type", "AddonCollectionGet").put("authKey", authKey).put("update", true)
        )
        return result.optJSONArray("addons") ?: JSONArray()
    }

    /**
     * Complete default Settings mirroring stremio-core's `impl Default for Settings`.
     * Every field must be present or stremio-core rejects the seeded profile.
     */
    fun defaultSettings(): JSONObject = JSONObject().apply {
        put("interfaceLanguage", "eng")
        put("hideSpoilers", false)
        put("gamepadSupport", false)
        put("streamingServerUrl", "http://127.0.0.1:11470/")
        put("playerType", JSONObject.NULL)
        put("bingeWatching", true)
        put("playInBackground", true)
        put("hardwareDecoding", true)
        put("videoMode", JSONObject.NULL)
        put("frameRateMatchingStrategy", "Disabled")
        put("nextVideoNotificationDuration", 35000)
        put("audioPassthrough", false)
        put("audioLanguage", "eng")
        put("secondaryAudioLanguage", JSONObject.NULL)
        put("subtitlesLanguage", "eng")
        put("secondarySubtitlesLanguage", JSONObject.NULL)
        put("subtitlesAutoSelect", true)
        put("subtitlesSize", 100)
        put("subtitlesFont", "Roboto")
        put("subtitlesBold", false)
        put("subtitlesOffset", 5)
        put("subtitlesTextColor", "#FFFFFFFF")
        put("subtitlesBackgroundColor", "#00000000")
        put("subtitlesOutlineColor", "#000000")
        put("subtitlesOpacity", 100)
        put("assSubtitlesStyling", false)
        put("escExitFullscreen", true)
        put("seekTimeDuration", 10000)
        put("seekShortTimeDuration", 3000)
        put("pauseOnMinimize", false)
        put("quitOnClose", true)
        put("surroundSound", false)
        put("streamingServerWarningDismissed", JSONObject.NULL)
        put("serverInForeground", false)
        put("sendCrashReports", true)
    }

    /**
     * Validate the authKey (throws on expiry), then assemble the full `profile`
     * object Stremio Web reads from localStorage.
     */
    fun buildProfile(authKey: String): JSONObject {
        val user = getUser(authKey) // throws ApiException if the session expired
        val addons = try { getAddonCollection(authKey) } catch (_: Exception) { JSONArray() }
        return JSONObject().apply {
            put("auth", JSONObject().put("key", authKey).put("user", user))
            put("addons", addons)
            put("addonsLocked", false)
            put("settings", defaultSettings())
        }
    }
}
