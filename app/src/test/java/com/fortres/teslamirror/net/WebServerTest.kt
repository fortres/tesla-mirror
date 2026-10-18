package com.fortres.teslamirror.net

import io.ktor.client.plugins.websocket.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class WebServerTest {
    private class Rec : WebServer.Listener {
        val msgs = java.util.concurrent.CopyOnWriteArrayList<Inbound>(); @Volatile var connected = 0; @Volatile var disconnected = 0
        override fun onClientConnected() { connected++ }
        override fun onMessage(msg: Inbound) { msgs += msg }
        override fun onClientDisconnected() { disconnected++ }
    }
    @Test fun servesIndex() = testApplication {
        val server = WebServer(listener = Rec()); application { with(server) { module() } }
        val r = client.get("/"); assertEquals(HttpStatusCode.OK, r.status); assertTrue(r.bodyAsText().contains("<title>tesla-mirror</title>"))
    }
    @Test fun deliversParsedMessagesAndIgnoresJunk() = testApplication {
        val rec = Rec(); val server = WebServer(listener = rec); application { with(server) { module() } }
        val c = createClient { install(WebSockets) }
        c.webSocket("/ws") {
            send("junk"); send("""{"t":"key","k":"home"}""")
            server.send("""{"t":"state"}""")
            assertEquals("""{"t":"state"}""", (incoming.receive() as Frame.Text).readText())
        }
        withContext(Dispatchers.Default) { withTimeout(2000) { while (rec.msgs.isEmpty()) delay(10) } }
        assertEquals(listOf(Inbound.Key("home")), rec.msgs); assertEquals(1, rec.connected)
    }
    @Test fun secondClientReplacesFirst() = testApplication {
        val rec = Rec(); val server = WebServer(listener = rec); application { with(server) { module() } }
        val c = createClient { install(WebSockets) }
        val first = c.webSocketSession("/ws")
        c.webSocket("/ws") {
            server.send("hi"); assertEquals("hi", (incoming.receive() as Frame.Text).readText())
            val close = first.closeReason.await(); assertEquals(CloseReason.Codes.GOING_AWAY.code, close?.code)
            assertEquals(0, rec.disconnected)
        }
    }
}
