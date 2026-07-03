package dev.zeroauth.android.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Monochrome palette — pure black background, white primary. ZeroAuth is
 * an authenticator: the brand is black-and-white, no colour accent. The
 * only non-grey is a restrained red for error states (a functional signal,
 * not brand colour). The `Ink*` names are kept so every call site compiles
 * unchanged; only the values moved from indigo back to monochrome.
 */
val InkBackground          = Color(0xFF000000) // pure black
val InkSurface             = Color(0xFF141414) // cards
val InkSurfaceVariant      = Color(0xFF1E1E1E) // raised / inputs
val InkOutline             = Color(0xFF333333) // dividers / outlined buttons

val InkPrimary             = Color(0xFFFFFFFF) // white — primary buttons
val InkOnPrimary           = Color(0xFF000000) // black text on white
val InkPrimaryContainer    = Color(0xFF1E1E1E) // dark disc (icon chips / success discs)
val InkOnPrimaryContainer  = Color(0xFFF5F5F5)

val InkSecondary           = Color(0xFFE0E0E0) // light-grey accent
val InkOnSecondary         = Color(0xFF000000)

val InkOnSurface           = Color(0xFFF5F5F5) // primary text (near-white)
val InkOnSurfaceVariant    = Color(0xFF9E9E9E) // muted grey text

val InkError               = Color(0xFFE5484D)
val InkOnError             = Color(0xFFFFFFFF)
