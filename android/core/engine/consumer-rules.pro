# Règles R8 transmises à l'application
-keep class com.tom_roush.** { *; }
-dontwarn com.tom_roush.**
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**
-dontwarn javax.naming.**
-dontwarn org.slf4j.**
-dontwarn com.gemalto.jp2.**
