plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.stremio.profileloader"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.stremio.profileloader"
        minSdk = 26
        targetSdk = 36
        versionCode = 13
        versionName = "0.1.12"
    }

    // A stable, intentionally-public signing key (committed in keystore/) so every
    // build — local or CI — shares one signature and installs as an update rather
    // than failing with "App not installed". This is NOT a secret: it only provides
    // upgrade continuity for a sideloaded app, it doesn't protect anything.
    signingConfigs {
        create("shared") {
            storeFile = rootProject.file("keystore/strloader.jks")
            storePassword = "strloader"
            keyAlias = "strloader"
            keyPassword = "strloader"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Reuse the shared picker UI (../../shared/picker) by copying it into the app's
// assets at build time. The picker then lives at assets/picker/ inside the APK.
val copyPicker by tasks.registering(Copy::class) {
    from(rootProject.file("../shared/picker"))
    // The shared API module is fetched from inside the WebView (browser network
    // stack) so logins use the same path that successfully loads Stremio.
    from(rootProject.file("../shared/stremio-api.js"))
    into(layout.buildDirectory.dir("generated/pickerAssets/picker"))
}

android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/pickerAssets"))

tasks.named("preBuild") {
    dependsOn(copyPicker)
}
