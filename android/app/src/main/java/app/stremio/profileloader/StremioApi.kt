package app.stremio.profileloader

/**
 * The Stremio API calls (login / getUser / addonCollectionGet / buildProfile)
 * run in the picker WebView via shared/stremio-api.js, using the device's
 * browser network stack. Kotlin only needs the persisted-state schema version
 * to seed alongside the profile.
 */
object StremioApi {
    /** stremio-core schema_version we seed; the app migrates older -> newer. */
    const val SCHEMA_VERSION = "22"
}
