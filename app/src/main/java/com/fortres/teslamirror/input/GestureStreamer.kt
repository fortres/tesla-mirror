package com.fortres.teslamirror.input

data class Finger(val id: Int, val x: Float, val y: Float)

data class Segment(
    val id: Int,
    val fromX: Float,
    val fromY: Float,
    val toX: Float,
    val toY: Float,
    val durationMs: Long,
    val willContinue: Boolean,
    val isNew: Boolean,
)

class GestureStreamer(
    val segmentMs: Long = 20,
    val tapMs: Long = 50,
    val maxStrokeMs: Long = 50_000,
    val watchdogMs: Long = 500,
) {
    private class FingerState(
        var curX: Float,
        var curY: Float,
        var targetX: Float,
        var targetY: Float,
        var strokeStartMs: Long,
    ) {
        var down = true
        var started = false
    }

    private val fingers = LinkedHashMap<Int, FingerState>()
    // Released fingers whose id was pressed again before their final segment was emitted.
    private val releasing = ArrayList<Pair<Int, FingerState>>()
    private var lastSnapshotMs = 0L

    val hasFingers: Boolean get() = fingers.isNotEmpty() || releasing.isNotEmpty()

    fun onSnapshot(fingers: List<Finger>, nowMs: Long) {
        lastSnapshotMs = nowMs
        val ids = fingers.mapTo(HashSet()) { it.id }
        for ((id, state) in this.fingers) if (id !in ids) state.down = false
        for (f in fingers) {
            val state = this.fingers[f.id]
            if (state == null) {
                this.fingers[f.id] = FingerState(f.x, f.y, f.x, f.y, nowMs)
            } else if (!state.down) {
                releasing += f.id to state
                this.fingers[f.id] = FingerState(f.x, f.y, f.x, f.y, nowMs)
            } else {
                state.targetX = f.x
                state.targetY = f.y
                state.down = true
            }
        }
    }

    fun releaseAll() {
        fingers.values.forEach { it.down = false }
    }

    fun restartStrokes(nowMs: Long) {
        // The cancel already ended the pointers of started, released fingers; a never-started one is still a pending tap.
        releasing.removeAll { it.second.started }
        val iter = fingers.values.iterator()
        while (iter.hasNext()) {
            val s = iter.next()
            if (!s.down && s.started) {
                iter.remove()
                continue
            }
            if (s.down) {
                s.started = false
                s.strokeStartMs = nowMs
            }
        }
    }

    fun nextBatch(nowMs: Long): List<Segment> {
        if (fingers.values.any { it.down } && nowMs - lastSnapshotMs > watchdogMs) releaseAll()
        val batch = ArrayList<Segment>(fingers.size + releasing.size)
        for ((id, s) in releasing) batch += emit(id, s, nowMs)
        releasing.clear()
        val iter = fingers.entries.iterator()
        while (iter.hasNext()) {
            val (id, s) = iter.next()
            batch += emit(id, s, nowMs)
            if (!s.down) iter.remove()
        }
        return batch
    }

    private fun emit(id: Int, s: FingerState, nowMs: Long): Segment {
        val cut = s.down && nowMs - s.strokeStartMs >= maxStrokeMs
        val willContinue = s.down && !cut
        val tap = !s.started && !s.down
        val seg = Segment(
            id = id,
            fromX = s.curX, fromY = s.curY, toX = s.targetX, toY = s.targetY,
            durationMs = if (tap) tapMs else segmentMs,
            willContinue = willContinue,
            isNew = !s.started,
        )
        s.curX = s.targetX
        s.curY = s.targetY
        s.started = willContinue
        if (cut) s.strokeStartMs = nowMs
        return seg
    }
}
