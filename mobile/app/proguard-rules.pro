# mobile/app/proguard-rules.pro — R8/ProGuard rules for the Phase 1
# Pramaan banking app. Rules are intentionally minimal in this scaffold
# (C-101). They will grow as real surfaces land — the rapidsnark JNI
# native methods in C-104, the Compose preview helpers, and the
# Kotlin reflection used by serialization once we add networking.

# ── Kotlin metadata ──────────────────────────────────────────────────────
# Required so kotlin-reflect sees the right shape of generic types after
# minification. Cheap to keep and the alternative is hard-to-diagnose
# IncompatibleClassChangeError at runtime.
-keepattributes *Annotation*, InnerClasses, EnclosingMethod, Signature

# ── Compose ──────────────────────────────────────────────────────────────
# AGP 8.x already ships the Compose-aware shrinker config; nothing extra
# needed for the scaffold.

# ── JNI (rapidsnark, lands in C-104) ─────────────────────────────────────
# Placeholder. When C-104 lands the rapidsnark JNI native method
# `nativeGenerateProof(witnessJson: String): String` on
# dev.zeroauth.prover.RapidsnarkProver, we will add:
#
#   -keepclasseswithmembernames class * { native <methods>; }
#   -keep class dev.zeroauth.prover.RapidsnarkProver { *; }
#
# Listed here so the rule is easy to find and uncomment.

# ── App package ─────────────────────────────────────────────────────────
# Keep Application + Activity classes from being renamed away from the
# names referenced in AndroidManifest.xml.
-keep public class dev.zeroauth.ZeroAuthApplication
-keep public class dev.zeroauth.MainActivity
