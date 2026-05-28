# Consumer Proguard rules for :biometric.
#
# Downstream consumers (:app, :prover) must keep:
#   - The FaceEmbedder + CommitmentBuilder public surface so JNI / native
#     symbols stay reachable when R8 shrinks the host app.
#   - TFLite native loader hooks — TFLite resolves its delegates by
#     reflection at first call.

-keep public class dev.zeroauth.biometric.FaceEmbedder { *; }
-keep public class dev.zeroauth.biometric.TfliteFaceEmbedder { *; }
-keep public class dev.zeroauth.biometric.CommitmentBuilder { *; }
-keep public class dev.zeroauth.biometric.Commitment { *; }
-keep public class dev.zeroauth.biometric.SaltProvider { *; }
-keep public class dev.zeroauth.biometric.KeystoreSaltProvider { *; }

# TFLite native interop — Google's recommendation for any host app
# that depends on tensorflow-lite (the rules from the TFLite README,
# trimmed to what we actually exercise).
-keep class org.tensorflow.lite.** { *; }
-keep class org.tensorflow.lite.gpu.** { *; }
-keep class org.tensorflow.lite.nnapi.** { *; }

# BouncyCastle — Keccak256.kt instantiates the provider lazily by
# class name. Without this rule R8 strips the constructor and the
# digest engine fails at runtime.
-keep class org.bouncycastle.jcajce.provider.digest.Keccak { *; }
-keep class org.bouncycastle.jcajce.provider.digest.Keccak$* { *; }
