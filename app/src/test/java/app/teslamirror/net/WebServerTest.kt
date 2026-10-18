package app.teslamirror.net

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
    @Test fun throwingListenerKeepsSocketAlive() = testApplication {
        val msgs = java.util.concurrent.CopyOnWriteArrayList<Inbound>()
        val server = WebServer(listener = object : WebServer.Listener {
            override fun onClientConnected() = Unit
            override fun onMessage(msg: Inbound) { msgs += msg; if (msgs.size == 1) error("boom") }
            override fun onClientDisconnected() = Unit
        })
        application { with(server) { module() } }
        val c = createClient { install(WebSockets) }
        c.webSocket("/ws") {
            send("""{"t":"key","k":"home"}"""); send("""{"t":"key","k":"back"}""")
            withContext(Dispatchers.Default) { withTimeout(2000) { while (msgs.size < 2) delay(10) } }
        }
        assertEquals(listOf(Inbound.Key("home"), Inbound.Key("back")), msgs.toList())
    }
    @Test fun sendWithoutClientDoesNotThrow() {
        WebServer(listener = Rec()).send("x")
    }
    @Test fun secondClientReplacesFirst() = testApplication {
        val rec = Rec(); val server = WebServer(listener = rec); application { with(server) { module() } }
        val c = createClient { install(WebSockets) }
        val first = c.webSocketSession("/ws")
        c.webSocket("/ws") {
            server.send("hi"); assertEquals("hi", (incoming.receive() as Frame.Text).readText())
            val close = first.closeReason.await(); assertEquals(CloseReason.Codes.GOING_AWAY.code, close?.code)
            withContext(Dispatchers.Default) { withTimeoutOrNull(200) { while (rec.disconnected == 0) delay(10) } }
            assertEquals(0, rec.disconnected)
        }
    }
}
