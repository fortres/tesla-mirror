package com.fortres.teslamirror.input

import org.junit.Assert.*
import org.junit.Test

class GestureStreamerTest {
    private fun f(id: Int, x: Float, y: Float) = Finger(id, x, y)

    @Test fun tapWithinOneTickIsSingleShortStroke() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 100f, 200f)), 0); s.onSnapshot(emptyList(), 5)
        assertEquals(listOf(Segment(0, 100f, 200f, 100f, 200f, 50, willContinue = false, isNew = true)), s.nextBatch(10))
        assertTrue(s.nextBatch(30).isEmpty()); assertFalse(s.hasFingers)
    }
    @Test fun holdEmitsContinuedZeroLengthSegments() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 10f, 10f)), 0)
        assertEquals(listOf(Segment(0, 10f, 10f, 10f, 10f, 20, true, isNew = true)), s.nextBatch(0))
        assertEquals(listOf(Segment(0, 10f, 10f, 10f, 10f, 20, true, isNew = false)), s.nextBatch(20))
    }
    @Test fun moveContinuesFromLastPoint() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        s.onSnapshot(listOf(f(0, 10f, 10f)), 15)
        assertEquals(listOf(Segment(0, 0f, 0f, 10f, 10f, 20, true, false)), s.nextBatch(20))
    }
    @Test fun releaseEndsStroke() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        s.onSnapshot(emptyList(), 30)
        assertEquals(listOf(Segment(0, 0f, 0f, 0f, 0f, 20, false, false)), s.nextBatch(40))
        assertTrue(s.nextBatch(60).isEmpty())
    }
    @Test fun twoFingersInOneBatch() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f), f(1, 50f, 50f)), 0)
        assertEquals(setOf(0, 1), s.nextBatch(0).map { it.id }.toSet())
    }
    @Test fun strokeIsSplitBeforeMaxDuration() {
        val s = GestureStreamer(maxStrokeMs = 100)
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        s.onSnapshot(listOf(f(0, 5f, 5f)), 140)
        val cut = s.nextBatch(150).single()
        assertEquals(false, cut.willContinue)
        val restarted = s.nextBatch(170).single()
        assertEquals(true, restarted.isNew)
        assertEquals(cut.toX, restarted.fromX, 0f)
        assertEquals(cut.toY, restarted.fromY, 0f)
        assertTrue(s.hasFingers)
    }
    @Test fun reusedIdAfterReleaseIsNewStroke() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        s.onSnapshot(emptyList(), 20); s.nextBatch(20)
        s.onSnapshot(listOf(f(0, 5f, 5f)), 40)
        assertEquals(true, s.nextBatch(40).single().isNew)
    }
    @Test fun watchdogReleasesStaleFingers() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        assertEquals(false, s.nextBatch(600).single().willContinue)
        assertFalse(s.hasFingers)
    }
    @Test fun releaseAllFinishesEveryFinger() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f), f(1, 1f, 1f)), 0); s.nextBatch(0)
        s.releaseAll()
        assertTrue(s.nextBatch(20).all { !it.willContinue }); assertFalse(s.hasFingers)
    }
    @Test fun restartStrokesStartsNewStrokesAtCurrentPoint() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 10f, 10f)), 0); s.nextBatch(0)
        s.restartStrokes(20)
        val seg = s.nextBatch(20).single()
        assertTrue(seg.isNew); assertEquals(10f, seg.fromX, 0f); assertTrue(seg.willContinue)
    }
    @Test fun reusedIdWithinOneTickReleasesThenStartsNew() {
        val s = GestureStreamer()
        s.onSnapshot(listOf(f(0, 0f, 0f)), 0); s.nextBatch(0)
        s.onSnapshot(emptyList(), 10)
        s.onSnapshot(listOf(f(0, 50f, 50f)), 15)
        val (end, start) = s.nextBatch(20)
        assertEquals(0, end.id); assertFalse(end.willContinue); assertEquals(0f, end.toX, 0f)
        assertEquals(0, start.id); assertTrue(start.isNew); assertEquals(50f, start.fromX, 0f)
    }
}
