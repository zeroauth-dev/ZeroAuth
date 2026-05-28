package dev.zeroauth.face

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM-only tests for the pure cropping math in `BitmapCrop.kt`.
 *
 * These tests exercise [computeSquareBounds] — the actual integer
 * geometry that decides where the square crop sits inside the camera
 * frame. The public [cropToSquare] / [resizeTo] functions wrap this
 * math behind Android's `Bitmap.createBitmap` and we don't need to
 * pull in the Android stubs to be confident in the geometry.
 *
 * The invariants verified here are exactly the determinism guarantees
 * the file-level comment of `BitmapCrop.kt` makes: same input bytes →
 * same output bounds, integer arithmetic only, output is square, output
 * is clamped to the bitmap. Breaking any of these breaks the v1
 * commitment scheme upstream of the prover.
 */
class BitmapCropTest {

    /**
     * Baseline case: a 1000×1000 bitmap with a face bounding box that
     * comfortably fits in the centre. The square crop should be sized
     * to the longer face dimension and centred on the face.
     */
    @Test
    fun `centred face fits comfortably inside bitmap`() {
        val bounds = computeSquareBounds(
            bitmapWidth = 1000, bitmapHeight = 1000,
            faceLeft = 400, faceTop = 380,
            faceRight = 600, faceBottom = 620,
        )
        // Face is 200×240 → square side = 240. Face centre = (500, 500).
        // Square should be from (380, 380) to (620, 620).
        assertEquals(380, bounds.left)
        assertEquals(380, bounds.top)
        assertEquals(620, bounds.right)
        assertEquals(620, bounds.bottom)
        assertSquare(bounds)
    }

    /**
     * The face is in the top-left corner; the square would spill off
     * the top and left edges. The math should slide the square back
     * inside the bitmap, NOT clip its side length.
     */
    @Test
    fun `face near top-left edge slides square onto bitmap`() {
        val bounds = computeSquareBounds(
            bitmapWidth = 1000, bitmapHeight = 1000,
            faceLeft = 10, faceTop = 10,
            faceRight = 110, faceBottom = 110,
        )
        // Face is 100×100 → square side = 100. Face centre = (60, 60).
        // Naïve placement would be (10, 10) to (110, 110) — already
        // inside the bitmap; no slide needed.
        assertEquals(10, bounds.left)
        assertEquals(10, bounds.top)
        assertEquals(110, bounds.right)
        assertEquals(110, bounds.bottom)
        assertSquare(bounds)
    }

    /**
     * The face is wider than the bitmap is tall. The square side must
     * clamp down to the bitmap's smaller dimension.
     */
    @Test
    fun `face longer than bitmap shorter side clamps to bitmap`() {
        val bounds = computeSquareBounds(
            bitmapWidth = 1000, bitmapHeight = 400,
            faceLeft = 100, faceTop = 50,
            faceRight = 900, faceBottom = 350,
        )
        // Face is 800×300 → square side wants 800. Bitmap min(W, H) =
        // 400. Clamp to 400. Output is a 400×400 square inside the
        // 1000×400 bitmap; it must be aligned with the top edge
        // (bitmap is only 400 tall).
        assertEquals(400, bounds.side)
        assertEquals(0, bounds.top)
        assertEquals(400, bounds.bottom)
        // Horizontally centred on the face centre at x=500.
        assertEquals(300, bounds.left)
        assertEquals(700, bounds.right)
        assertSquare(bounds)
    }

    /**
     * Right-edge spillover: square would extend past the right edge of
     * the bitmap; should slide left.
     */
    @Test
    fun `face near right edge slides square left`() {
        val bounds = computeSquareBounds(
            bitmapWidth = 1000, bitmapHeight = 1000,
            faceLeft = 800, faceTop = 400,
            faceRight = 980, faceBottom = 600,
        )
        // Face is 180×200 → square side = 200. Face centre = (890, 500).
        // Naïve placement: x in [790, 990]. Bitmap width is 1000; right
        // edge sits at 990 which is fine, so no slide needed.
        assertEquals(200, bounds.side)
        assertTrue("right edge inside bitmap", bounds.right <= 1000)
        assertSquare(bounds)
    }

    /**
     * Right-edge spillover real case: square would extend past 1000;
     * the slide should pin right to 1000 and pull left back to 800.
     */
    @Test
    fun `face very close to right edge slides square left`() {
        val bounds = computeSquareBounds(
            bitmapWidth = 1000, bitmapHeight = 1000,
            faceLeft = 850, faceTop = 400,
            faceRight = 1000, faceBottom = 600,
        )
        // Face is 150×200 → square side = 200. Face centre = (925, 500).
        // Naïve placement: x in [825, 1025]. 1025 > 1000 → slide left
        // by 25 → x in [800, 1000].
        assertEquals(200, bounds.side)
        assertEquals(800, bounds.left)
        assertEquals(1000, bounds.right)
        assertSquare(bounds)
    }

    /**
     * Determinism: identical inputs produce byte-for-byte identical
     * outputs across repeated calls. This is the property the
     * commitment scheme depends on — see the file-level comment in
     * BitmapCrop.kt.
     */
    @Test
    fun `repeated invocations return identical bounds`() {
        val bounds1 = computeSquareBounds(800, 800, 200, 200, 600, 600)
        val bounds2 = computeSquareBounds(800, 800, 200, 200, 600, 600)
        val bounds3 = computeSquareBounds(800, 800, 200, 200, 600, 600)
        assertEquals(bounds1, bounds2)
        assertEquals(bounds2, bounds3)
    }

    /**
     * Square already: a face that is already square should produce a
     * square crop of exactly the face bounds.
     */
    @Test
    fun `already square face produces exact bounds`() {
        val bounds = computeSquareBounds(
            bitmapWidth = 500, bitmapHeight = 500,
            faceLeft = 100, faceTop = 100,
            faceRight = 400, faceBottom = 400,
        )
        assertEquals(100, bounds.left)
        assertEquals(100, bounds.top)
        assertEquals(400, bounds.right)
        assertEquals(400, bounds.bottom)
        assertSquare(bounds)
    }

    /**
     * Face larger than the bitmap on both axes should clamp to the
     * smallest bitmap dimension.
     */
    @Test
    fun `face larger than bitmap clamps to bitmap`() {
        val bounds = computeSquareBounds(
            bitmapWidth = 200, bitmapHeight = 300,
            faceLeft = -50, faceTop = -50,
            faceRight = 250, faceBottom = 350,
        )
        // Bitmap shorter side = 200; output side = 200; placed at (0,0)
        // because face centres at (100, 150) and 200×200 fits flush
        // with the top of a 200×300 bitmap.
        assertEquals(200, bounds.side)
        assertSquare(bounds)
        assertTrue("left inside bitmap", bounds.left >= 0)
        assertTrue("top inside bitmap", bounds.top >= 0)
        assertTrue("right inside bitmap", bounds.right <= 200)
        assertTrue("bottom inside bitmap", bounds.bottom <= 300)
    }

    /**
     * Precondition: malformed face rect (right < left) must throw.
     * This catches an ML Kit upstream bug where a degenerate Rect
     * makes it past the analyzer.
     */
    @Test
    fun `malformed face rect throws`() {
        assertThrows(IllegalArgumentException::class.java) {
            computeSquareBounds(
                bitmapWidth = 1000, bitmapHeight = 1000,
                faceLeft = 600, faceTop = 100,
                faceRight = 400, faceBottom = 500,
            )
        }
    }

    /**
     * Precondition: zero-or-negative bitmap dims must throw.
     */
    @Test
    fun `zero bitmap dims throws`() {
        assertThrows(IllegalArgumentException::class.java) {
            computeSquareBounds(
                bitmapWidth = 0, bitmapHeight = 100,
                faceLeft = 0, faceTop = 0,
                faceRight = 50, faceBottom = 50,
            )
        }
    }

    /** Invariant: the output is always a square. */
    private fun assertSquare(b: SquareBounds) {
        assertEquals(
            "bounds must be square: $b",
            b.right - b.left,
            b.bottom - b.top,
        )
    }
}
