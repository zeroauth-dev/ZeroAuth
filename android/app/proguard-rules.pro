# proguard-rules.pro — release-only ProGuard/R8 rules.
#
# Today the release variant is gated behind a follow-on signing-config task.
# This file exists so the buildType.release block's proguardFiles() reference
# resolves; the real rules will be tuned once we run the first
# bundleRelease and see which kotlinx-serialization + ML Kit reflective
# paths R8 strips by accident.
#
# Defaults from proguard-android-optimize.txt already cover the common
# Android paths. Add ZeroAuth-specific keep rules below as needed.

# kotlinx.serialization — keep the @Serializable companions reflection touches
-keepclassmembers class kotlinx.** { *; }
-keepclassmembers @kotlinx.serialization.Serializable class * { *; }

# Retrofit — keep generic signatures so kotlinx-serialization-converter
# can recover the response type.
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepattributes RuntimeVisibleTypeAnnotations, AnnotationDefault

# ML Kit barcode (bundled) — its native libraries are loaded reflectively.
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**
