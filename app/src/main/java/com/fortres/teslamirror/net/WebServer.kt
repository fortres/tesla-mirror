package com.fortres.teslamirror.net

import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.http.content.default
import io.ktor.server.http.content.staticFiles
import io.ktor.server.http.content.staticResources
import io.ktor.server.routing.routing
import io.ktor.server.websocket.DefaultWebSocketServerSession
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.pingPeriod
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import java.io.File
import java.util.logging.Logger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlin.time.Duration.Companion.seconds

class WebServer(
    private val port: Int = 8080,
    private val devDir: File? = null,
    private val listener: Listener,
) {
    interface Listener {
        fun onClientConnected()
        fun onMessage(msg: Inbound)
        fun onClientDisconnected()
    }

    private val log = Logger.getLogger("TeslaMirror")
    private val current = AtomicReference<DefaultWebSocketServerSession?>(null)
    private var engine: EmbeddedServer<*, *>? = null

    fun start() {
        if (engine != null) {
            log.info("start ignored: already started")
            return
        }
        engine = embeddedServer(CIO, port = port, host = "0.0.0.0") { module() }.also { it.start(wait = false) }
    }

    fun stop() {
        engine?.stop(500, 1000)
        engine = null
    }

    fun send(text: String) {
        val session = current.get() ?: return
        val sent = try {
            session.outgoing.trySend(Frame.Text(text)).isSuccess
        } catch (e: Exception) {
            false
        }
        if (!sent) log.warning("dropped outbound frame: client buffer full or closed")
    }

    fun Application.module() {
        install(WebSockets) { pingPeriod = 15.seconds }
        routing {
            if (devDir != null && devDir.isDirectory) staticFiles("/", devDir) { default("index.html") }
            else staticResources("/", "public") { default("index.html") }
            webSocket("/ws") {
                val session = this
                current.getAndSet(session)?.close(CloseReason(CloseReason.Codes.GOING_AWAY, "replaced"))
                listener.onClientConnected()
                try {
                    for (frame in incoming) {
                        if (frame !is Frame.Text) continue
                        try {
                            Protocol.parse(frame.readText())?.let(listener::onMessage)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            log.warning("message handling failed: ${e.message}")
                        }
                    }
                } finally {
                    if (current.compareAndSet(session, null)) listener.onClientDisconnected()
                }
            }
        }
    }
}
