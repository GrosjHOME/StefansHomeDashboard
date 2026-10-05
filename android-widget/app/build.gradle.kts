plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ch.grosjhome.zuhause"
    compileSdk = 35

    defaultConfig {
        applicationId = "ch.grosjhome.zuhause"
        minSdk = 29                       // Android 10+
        targetSdk = 35
        // Jede Version braucht eine hoehere Nummer, damit Android das Update annimmt:
        // im GitHub-Workflow = Laufnummer des Builds.
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = "1." + (System.getenv("VERSION_CODE") ?: "0")
    }

    // Fester Signatur-Schluessel, damit Updates ueber die installierte Version gehen.
    // Wird beim ersten Build im GitHub-Workflow erzeugt und eingecheckt (siehe README).
    signingConfigs {
        create("widget") {
            storeFile = file("../keystore/zuhause-widget.jks")
            storePassword = "zuhause-widget"
            keyAlias = "zuhause"
            keyPassword = "zuhause-widget"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("widget")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.work:work-runtime:2.9.1")   // planbare Hintergrund-Aktualisierung
}
