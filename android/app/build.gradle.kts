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
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
    into(layout.buildDirectory.dir("generated/pickerAssets/picker"))
}

android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/pickerAssets"))

tasks.named("preBuild") {
    dependsOn(copyPicker)
}
