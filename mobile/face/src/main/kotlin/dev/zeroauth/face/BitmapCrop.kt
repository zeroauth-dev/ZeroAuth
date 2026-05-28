package dev.zeroauth.face

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect

/**
 * Deterministic crop + resize helpers for the captured face bitmap.
 *
 * ## Why deterministic matters
 *
 * The downstream `:biometric` module (lands with C-143) hashes the
 * captured face via SHA-256 to form the commitment that backs the DID
 * (Scene 1 step 7 — `commitment = Poseidon([secret, salt])` where the
 * `secret` is derived from this hash through the fuzzy extractor). If
 * the same physical face produces a different bitmap on two runs of
 * the capture flow — because the crop math reads the floating-point
 * face bounds rounded differently, or because the resize uses a
 * source-system-default filter — the commitment differs and the DID
 * cannot be re-derived during a future login.
 *
 * The two functions in this file therefore enforce:
 *
 *   1. Integer pixel coordinates only. ML Kit returns face bounds as
 *      a `Rect` with int coordinates, but the centring-square
 *      derivation in [computeSquareBounds] can produce sub-pixel
 *      ambiguity if it goes via floats. We round explicitly at one
 *      well-defined point and don't go via floats anywhere else.
 *   2. A fixed resize filter: bilinear with `filter=true`. The same
 *      `Bitmap.createScaledBitmap` call on the same input pixels is
 *      guaranteed by Android's pixel pipeline to produce the same
 *      output bytes across SKUs.
 *
 * ## Module-boundary contract
 *
 * The body of both functions calls only:
 *
 *   * [computeSquareBounds] — pure top-level function, JVM-testable.
 *   * `Bitmap.createBitmap(...)` — Android SDK, deterministic given
 *     identical inputs (the rotation matrix passed is the identity).
 *   * `Bitmap.createScaledBitmap(...)` — Android SDK, deterministic.
 *
 * No `Math.random()`, no `System.currentTimeMillis()`, no IO. Every
 * branch decision is a pure function of the input bytes + the bounds
 * rect.
 *
 * The pure math under [computeSquareBounds] is what
 * `mobile/face/src/test/kotlin/dev/zeroauth/face/BitmapCropTest.kt`
 * exercises on the JVM — neither test imports `android.graphics.*`.
 */

/**
 * Crop [bitmap] to a centered square that contains the face bounding
 * box [bounds], clipped to the bitmap's extents.
 *
 * If [bounds] is wider than tall (or vice versa), the output square
 * is the larger of the two dimensions, centred on the original bound's
 * centre, clipped to the bitmap. This ensures we always emit a square
 * bitmap (the downstream embedder wants square inputs) without losing
 * the face if the detected box is non-square.
 */
fun cropToSquare(bitmap: Bitmap, bounds: Rect): Bitmap {
    val square = computeSquareBounds(
        bitmapWidth = bitmap.width,
        bitmapHeight = bitmap.height,
        faceLeft = bounds.left,
        faceTop = bounds.top,
        faceRight = bounds.right,
        faceBottom = bounds.bottom,
    )
    return Bitmap.createBitmap(
        bitmap,
        square.left,
        square.top,
        square.right - square.left,
        square.bottom - square.top,
        // Identity matrix — no rotation, no skew. Determinism gate.
        Matrix(),
        // filter=false here because we're not scaling at this step; the
        // resize step below is the only place the bilinear filter is
        // applied.
        false,
    )
}

/**
 * Resize [bitmap] to a square output of side length [size].
 *
 * The resulting bitmap is always `size × size`. The input is expected
 * to be square already (produced by [cropToSquare]); if it is not, the
 * aspect ratio is broken — the embedder expects pre-cropped square
 * input.
 *
 * Uses `Bitmap.createScaledBitmap` with `filter=true` (bilinear). See
 * the file-level comment for the determinism rationale.
 */
fun resizeTo(bitmap: Bitmap, size: Int): Bitmap {
    require(size > 0) {
        "resizeTo: target size must be positive, was $size"
    }
    return Bitmap.createScaledBitmap(bitmap, size, size, true)
}

/**
 * Pure square-bounds derivation — the actual cropping math.
 *
 * Pulled out of [cropToSquare] so it can be JVM-tested without an
 * Android Bitmap dependency. The function operates on plain `Int`s.
 *
 * Algorithm:
 *
 *   1. Compute the face's centre and the face's longest side.
 *   2. Build a square of that side length, centred on the face centre.
 *   3. If the square spills off the bitmap on any edge, slide it back
 *      onto the bitmap (preserving the side length where possible).
 *      If the bitmap is smaller than the requested square on that
 *      axis, clamp the side length to fit.
 *   4. Round all coordinates to ints; the inputs are already int so
 *      no rounding error is introduced.
 *
 * @return a [SquareBounds] with `left <= right` and `top <= bottom`,
 *   all within `[0, bitmapWidth/Height]` and `right - left ==
 *   bottom - top` (the output is always square).
 */
internal fun computeSquareBounds(
    bitmapWidth: Int,
    bitmapHeight: Int,
    faceLeft: Int,
    faceTop: Int,
    faceRight: Int,
    faceBottom: Int,
): SquareBounds {
    require(bitmapWidth > 0 && bitmapHeight > 0) {
        "computeSquareBounds: bitmap dims must be positive, were ${bitmapWidth}×${bitmapHeight}"
    }
    require(faceRight >= faceLeft && faceBottom >= faceTop) {
        "computeSquareBounds: face rect malformed: " +
            "($faceLeft,$faceTop)-($faceRight,$faceBottom)"
    }

    val faceWidth = faceRight - faceLeft
    val faceHeight = faceBottom - faceTop
    val side = maxOf(faceWidth, faceHeight)

    // The side may exceed either bitmap dimension. Clamp it down to
    // the smaller of the two dimensions in that case so the square
    // still fits inside the bitmap.
    val clampedSide = minOf(side, bitmapWidth, bitmapHeight)

    val centreX = faceLeft + faceWidth / 2
    val centreY = faceTop + faceHeight / 2

    // Initial square placement around the face centre.
    var left = centreX - clampedSide / 2
    var top = centreY - clampedSide / 2

    // Slide back inside the bitmap if we spilled off any edge.
    if (left < 0) left = 0
    if (top < 0) top = 0
    if (left + clampedSide > bitmapWidth) left = bitmapWidth - clampedSide
    if (top + clampedSide > bitmapHeight) top = bitmapHeight - clampedSide

    return SquareBounds(
        left = left,
        top = top,
        right = left + clampedSide,
        bottom = top + clampedSide,
    )
}

/**
 * Pure data class for the int square-bounds output of
 * [computeSquareBounds]. We don't reuse `android.graphics.Rect` here
 * because Rect is an Android class and the pure tests would have to
 * either depend on Android stubs or use reflection — neither is worth
 * it for a four-field tuple.
 */
internal data class SquareBounds(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
) {
    init {
        check(right - left == bottom - top) {
            "SquareBounds invariant: must be square, was " +
                "$left,$top -> $right,$bottom"
        }
    }

    val side: Int get() = right - left
}
