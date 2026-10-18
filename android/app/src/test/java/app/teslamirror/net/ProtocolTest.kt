package app.teslamirror.net

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    @Test fun parsesTouchSnapshot() {
        val m = Protocol.parse("""{"t":"touch","pts":[{"id":0,"x":0.42,"y":0.71},{"id":1,"x":0.58,"y":0.33}]}""")
        assertEquals(Inbound.Touch(listOf(Point(0, 0.42f, 0.71f), Point(1, 0.58f, 0.33f))), m)
    }
    @Test fun parsesEmptyTouchAsAllUp() = assertEquals(Inbound.Touch(emptyList()), Protocol.parse("""{"t":"touch","pts":[]}"""))
    @Test fun parsesKey() = assertEquals(Inbound.Key("back"), Protocol.parse("""{"t":"key","k":"back"}"""))
    @Test fun parsesOfferAndIce() {
        assertEquals(Inbound.Offer("v=0"), Protocol.parse("""{"t":"offer","sdp":"v=0"}"""))
        val ice = Protocol.parse("""{"t":"ice","candidate":{"candidate":"c","sdpMid":"0"}}""") as Inbound.Ice
        assertEquals("c", ice.candidate["candidate"]!!.jsonPrimitive.content)
    }
    @Test fun junkReturnsNull() {
        assertNull(Protocol.parse("not json"))
        assertNull(Protocol.parse("""{"t":"nope"}"""))
        assertNull(Protocol.parse("""{"t":"touch"}"""))
        assertNull(Protocol.parse("""{"t":"key"}"""))
        assertNull(Protocol.parse("""{"t":"key","k":null}"""))
        assertNull(Protocol.parse("""{"t":"key","k":5}"""))
        assertNull(Protocol.parse("""{"t":"touch","pts":[{"id":0,"x":"0.4","y":0.5}]}"""))
        assertNull(Protocol.parse("""{"t":"key","k":"foo"}"""))
        assertNull(Protocol.parse("""{"t":"offer","sdp":null}"""))
        assertNull(Protocol.parse("""{"t":"touch","pts":[{"id":0,"x":1e999,"y":0}]}"""))
        assertNull(Protocol.parse("[1]"))
    }
    @Test fun buildsState() {
        val j = Json.parseToJsonElement(Protocol.state(true, false, 1440, 720)).jsonObject
        assertEquals("state", j["t"]!!.jsonPrimitive.content)
        assertEquals(true, j["capturing"]!!.jsonPrimitive.boolean)
        assertEquals(false, j["accessibility"]!!.jsonPrimitive.boolean)
        assertEquals(1440, j["capture"]!!.jsonObject["w"]!!.jsonPrimitive.int)
        assertEquals("webrtc", j["transport"]!!.jsonPrimitive.content)
        assertEquals(true, j["touch"]!!.jsonPrimitive.boolean)
    }
    @Test fun buildsAnswerAndIce() {
        assertEquals("""{"t":"answer","sdp":"v=0"}""", Protocol.answer("v=0"))
        assertEquals("""{"t":"ice","candidate":{"candidate":"c"}}""", Protocol.ice(buildJsonObject { put("candidate", "c") }))
    }
}
