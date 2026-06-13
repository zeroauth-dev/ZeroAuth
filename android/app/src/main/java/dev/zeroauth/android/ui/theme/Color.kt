package dev.zeroauth.android.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Premium indigo palette — matches the attendance mockups + the HR admin
 * portal. Always-dark: near-black surfaces with a subtle indigo tint and
 * an indigo accent for primary actions. The names keep the historical
 * `Ink*` prefix so existing call sites compile unchanged; only the values
 * moved from monochrome to indigo.
 */
val InkBackground          = Color(0xFF0A0A0F) // near-black, faint blue
val InkSurface             = Color(0xFF15151F) // cards
val InkSurfaceVariant      = Color(0xFF1C1C2A) // raised / inputs
val InkOutline             = Color(0xFF2A2A3A) // dividers / outlined buttons

val InkPrimary             = Color(0xFF6366F1) // indigo — primary buttons / FAB
val InkOnPrimary           = Color(0xFFFFFFFF) // text on indigo
val InkPrimaryContainer    = Color(0xFF2A2A55) // dark indigo container (success discs)
val InkOnPrimaryContainer  = Color(0xFFC7C9FF)

val InkSecondary           = Color(0xFF8B80F9) // lighter indigo accent
val InkOnSecondary         = Color(0xFF0A0A0F)

val InkOnSurface           = Color(0xFFF5F5FA) // primary text
val InkOnSurfaceVariant    = Color(0xFFA2A2B8) // muted text

val InkError               = Color(0xFFEF4444)
val InkOnError             = Color(0xFFFFFFFF)
