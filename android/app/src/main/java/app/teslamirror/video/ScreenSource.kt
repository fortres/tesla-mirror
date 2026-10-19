package app.teslamirror.video

import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

fun captureSize(displayW: Int, displayH: Int, scale: Int = 2): Pair<Int, Int> =
    ((displayW / scale) and 1.inv()) to ((displayH / scale) and 1.inv())

class ScreenSource(
    private val context: Context,
    projection: Intent,
    private val onStopped: () -> Unit,
) {
    var width: Int
        private set
    var height: Int
        private set
    var onSizeChanged: (Int, Int) -> Unit = { _, _ -> }

    private val windowManager = context.getSystemService(WindowManager::class.java)
    private val displayManager = context.getSystemService(DisplayManager::class.java)
    private val capturer = ScreenCapturerAndroid(projection, object : MediaProjection.Callback() {
        override fun onStop() {
            onStopped()
        }
    })
    private val helper = SurfaceTextureHelper.create("capture", Rtc.egl.eglBaseContext)
    private val source: VideoSource = Rtc.factory.createVideoSource(true)
    val track: VideoTrack
    private var stopped = false
    private var started = false
    private val listener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) {}
        override fun onDisplayRemoved(displayId: Int) {}
        override fun onDisplayChanged(displayId: Int) {
            onDisplayChanged()
        }
    }

    init {
        val size = currentSize()
        width = size.first
        height = size.second
        capturer.initialize(helper, context, source.capturerObserver)
        track = Rtc.factory.createVideoTrack("screen", source)
    }

    private fun currentSize(): Pair<Int, Int> {
        val b = windowManager.maximumWindowMetrics.bounds
        return captureSize(b.width(), b.height())
    }

    fun start() {
        if (started || stopped) return
        started = true
        capturer.startCapture(width, height, FPS)
        displayManager.registerDisplayListener(listener, Handler(Looper.myLooper() ?: Looper.getMainLooper()))
    }

    fun onDisplayChanged() {
        if (stopped) return
        val size = currentSize()
        if (size.first == width && size.second == height) return
        width = size.first
        height = size.second
        capturer.changeCaptureFormat(width, height, FPS)
        onSizeChanged(width, height)
    }

    fun stop() {
        if (stopped) return
        stopped = true
        displayManager.unregisterDisplayListener(listener)
        capturer.stopCapture()
        capturer.dispose()
        track.dispose()
        source.dispose()
        helper.dispose()
    }

    companion object {
        const val FPS = 30
    }
}
