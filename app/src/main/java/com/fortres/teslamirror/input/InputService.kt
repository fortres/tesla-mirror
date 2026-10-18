package com.fortres.teslamirror.input

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.accessibilityservice.GestureDescription.StrokeDescription
import android.content.Intent
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import com.fortres.teslamirror.net.Point

class InputService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private val streamer = GestureStreamer()
    private val strokes = HashMap<Int, StrokeDescription>()
    private var inFlight = false

    private val callback = object : GestureResultCallback() {
        override fun onCompleted(gestureDescription: GestureDescription?) = onDispatchDone()
        override fun onCancelled(gestureDescription: GestureDescription?) = onDispatchDone()
    }

    override fun onServiceConnected() {
        InputBridge.service = this
        Log.i(TAG, "connected")
    }

    override fun onUnbind(intent: Intent?): Boolean {
        InputBridge.service = null
        Log.w(TAG, "service disconnected")
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        InputBridge.service = null
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    fun onTouch(pts: List<Point>) {
        handler.post {
            val bounds = getSystemService(WindowManager::class.java).currentWindowMetrics.bounds
            val fingers = pts.map {
                val (x, y) = CoordMapper.toPixels(it.x, it.y, bounds.width(), bounds.height())
                Finger(it.id, x, y)
            }
            streamer.onSnapshot(fingers, SystemClock.uptimeMillis())
            pump()
        }
    }

    fun onKey(key: String) {
        val action = when (key) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            else -> return
        }
        handler.post { performGlobalAction(action) }
    }

    private fun onDispatchDone() {
        inFlight = false
        pump()
    }

    private fun pump() {
        if (inFlight) return
        val batch = streamer.nextBatch(SystemClock.uptimeMillis())
        if (batch.isEmpty()) return
        val builder = GestureDescription.Builder()
        for (seg in batch) {
            val path = Path().apply {
                moveTo(seg.fromX, seg.fromY)
                lineTo(seg.toX, seg.toY)
            }
            val prev = if (seg.isNew) null else strokes[seg.id]
            val stroke = prev?.continueStroke(path, 0, seg.durationMs, seg.willContinue)
                ?: StrokeDescription(path, 0, seg.durationMs, seg.willContinue)
            if (seg.willContinue) strokes[seg.id] = stroke else strokes.remove(seg.id)
            builder.addStroke(stroke)
        }
        inFlight = true
        if (!dispatchGesture(builder.build(), callback, null)) {
            inFlight = false
            strokes.clear()
            streamer.releaseAll()
            Log.w(TAG, "dispatchGesture rejected")
        }
    }

    private companion object {
        const val TAG = "TeslaMirror"
    }
}
