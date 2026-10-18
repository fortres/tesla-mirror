package app.teslamirror.input

import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue

class StrokePlannerTest {
    private fun seg(fromX: Float, toX: Float, isNew: Boolean, willContinue: Boolean = true) =
        Segment(0, fromX, 5f, toX, 5f, 20, willContinue, isNew)

    @Test
    fun newSegmentKeepsCoordinates() {
        val p = planStroke(seg(1f, 9f, isNew = true), null)
        assertEquals(PlannedStroke(1f, 5f, 9f, 5f, true), p)
    }

    @Test
    fun continuedStillSegmentIsNudged() {
        val p = planStroke(seg(10f, 10f, isNew = false), 10f to 5f)
        assertEquals(10.5f, p.toX)
        assertEquals(10f, p.fromX)
        assertFalse(p.isNew)
    }

    @Test
    fun continuedSegmentMovesBackFromNudgedEnd() {
        val p = planStroke(seg(10f, 10f, isNew = false), 10.5f to 5f)
        assertEquals(10.5f, p.fromX)
        assertEquals(10f, p.toX)
    }

    @Test
    fun continuedSegmentWithoutStoredEndBecomesNew() {
        val p = planStroke(seg(3f, 4f, isNew = false), null)
        assertTrue(p.isNew)
        assertEquals(3f, p.fromX)
    }
}
