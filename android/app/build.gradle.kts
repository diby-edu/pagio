import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Signature release : les secrets restent hors du code, dans keystore.properties (non versionné).
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.pagio.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pagio.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Téléphones ARM 64/32 bits + émulateurs x86_64 (le x86 32 bits, obsolète, est exclu pour alléger l'APK).
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
        // Adresse du serveur Pagio par défaut (modifiable dans Réglages > Serveur).
        // 10.0.2.2 = l'ordinateur hôte vu depuis l'émulateur Android.
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"${project.findProperty("pagio.serverUrl") ?: "http://10.0.2.2:8787"}\"")
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
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += setOf(
            "META-INF/versions/9/OSGI-INF/MANIFEST.MF",
            "META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*",
            "META-INF/*.kotlin_module"
        )
    }
    androidResources {
        generateLocaleConfig = true
    }
}

dependencies {
    implementation(project(":core:engine"))
    implementation(project(":core:ai"))
    implementation(project(":core:cloud"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.mlkit.document.scanner)
    implementation(libs.reorderable)
    debugImplementation(libs.androidx.ui.tooling)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.test.runner)
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
