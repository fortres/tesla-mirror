package com.fortres.teslamirror

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.fortres.teslamirror.input.InputBridge
import com.fortres.teslamirror.net.Inbound
import com.fortres.teslamirror.net.Protocol
import com.fortres.teslamirror.net.WebServer
import com.fortres.teslamirror.video.PeerManager
import com.fortres.teslamirror.video.Rtc
import com.fortres.teslamirror.video.ScreenSource
import java.io.File
import kotlinx.coroutines.flow.updateAndGet

class MirrorService : Service(), WebServer.Listener {
    companion object {
        const val ACTION_SERVE = "com.fortres.teslamirror.SERVE"
        const val ACTION_START = "com.fortres.teslamirror.START"
        const val ACTION_STOP = "com.fortres.teslamirror.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        private const val CHANNEL = "mirror"
        private const val NOTIFICATION_ID = 1
        private const val PORT = 8080
    }

    // Every PeerManager/ScreenSource call and every state change happens on this thread.
    private val thread = HandlerThread("mirror").also { it.start() }
    private val worker = Handler(thread.looper)
    private lateinit var server: WebServer
    private var source: ScreenSource? = null
    private var peer: PeerManager? = null
    private var clientConnected = false

    private val refresh = object : Runnable {
        override fun run() {
            if (ticks++ % 5 == 0) {
                val ip = NetUtil.pickHotspotAddress(NetUtil.currentInterfaces())
                publish { it.copy(url = ip?.let { a -> "http://$a:$PORT" }) }
            }
            publish { it.copy(accessibility = InputBridge.enabled) }
            worker.postDelayed(this, 2000)
        }
    }
    private var ticks = 0

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "tesla-mirror", NotificationManager.IMPORTANCE_LOW))
        enterForeground(capturing = false)
        Rtc.init(this)
        server = WebServer(PORT, File(getExternalFilesDir(null), "web"), this).also { it.start() }
        worker.post {
            publish { it.copy(serverRunning = true) }
            refresh.run()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val data = intent.getParcelableExtra<Intent>(EXTRA_DATA)
                if (data == null) {
                    enterForeground(capturing = false)
                } else {
                    enterForeground(capturing = true)
                    worker.post { startCapture(data) }
                }
            }
            ACTION_STOP -> worker.post { stopCapture() }
        }
        return START_STICKY
    }

    private fun enterForeground(capturing: Boolean) {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setContentText(if (capturing) "tesla-mirror capturing" else "tesla-mirror serving")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            val type = if (capturing) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startCapture(data: Intent) {
        stopCapture()
        val s = ScreenSource(this, data, onStopped = { worker.post { stopCapture() } })
        s.onSizeChanged = { w, h -> worker.post { publish { it.copy(captureW = w, captureH = h) } } }
        s.start()
        source = s
        publish { it.copy(capturing = true, captureW = s.width, captureH = s.height) }
    }

    private fun stopCapture() {
        peer?.close()
        peer = null
        source?.stop()
        source = null
        publish { it.copy(capturing = false) }
    }

    private fun publish(change: (State) -> State) {
        val before = MirrorState.flow.value
        val after = MirrorState.flow.updateAndGet(change)
        if (after != before && clientConnected) sendState()
    }

    private fun sendState() {
        val s = MirrorState.flow.value
        server.send(Protocol.state(s.capturing, s.accessibility, s.captureW, s.captureH))
    }

    override fun onClientConnected() {
        worker.post {
            clientConnected = true
            sendState()
        }
    }

    override fun onMessage(msg: Inbound) {
        worker.post {
            when (msg) {
                is Inbound.Offer -> source?.let { s ->
                    peer?.close()
                    peer = PeerManager(s.track) { text -> server.send(text) }.also { it.onOffer(msg.sdp) }
                }
                is Inbound.Ice -> peer?.onRemoteIce(msg.candidate)
                is Inbound.Touch -> InputBridge.service?.onTouch(msg.pts)
                is Inbound.Key -> InputBridge.service?.onKey(msg.key)
            }
        }
    }

    override fun onClientDisconnected() {
        worker.post {
            clientConnected = false
            peer?.close()
            peer = null
        }
    }

    override fun onDestroy() {
        worker.removeCallbacksAndMessages(null)
        worker.post {
            stopCapture()
            server.stop()
            publish { it.copy(serverRunning = false) }
            thread.quitSafely()
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
