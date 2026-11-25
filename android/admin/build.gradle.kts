import java.util.Properties

// Pagio Admin : application à part, jamais publiée, qui affiche le tableau de bord d'admin.pagio.site sur le téléphone
// (certificat d'appareil + mot de passe + double authentification, comme sur PC) et envoie des notifications.
// Bibliothèques : le système Android (WebView, KeyChain, JobScheduler) et Firebase Messaging pour les notifications
// instantanées. Firebase est configuré à distance (réglage collé dans le tableau de bord) : pas de google-services.json ici.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.pagio.admin"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pagio.admin"
        minSdk = 26
        targetSdk = 36
        versionName = "1.1.0"
        versionCode = 10100
        buildConfigField("String", "ADMIN_URL", "\"${project.findProperty("pagio.adminUrl") ?: "https://admin.pagio.site"}\"")
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
}
