package com.fortres.teslamirror.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

data class Point(val id: Int, val x: Float, val y: Float)

sealed interface Inbound {
    data class Offer(val sdp: String) : Inbound
    data class Ice(val candidate: JsonObject) : Inbound
    data class Touch(val pts: List<Point>) : Inbound
    data class Key(val key: String) : Inbound
}

object Protocol {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(text: String): Inbound? = runCatching {
        val o = json.parseToJsonElement(text).jsonObject
        when (o.str("t")) {
            "offer" -> Inbound.Offer(o.str("sdp")!!)
            "ice" -> Inbound.Ice(o["candidate"] as JsonObject)
            "touch" -> Inbound.Touch((o["pts"] as JsonArray).map { point(it as JsonObject)!! })
            "key" -> Inbound.Key(o.str("k")!!)
            else -> null
        }
    }.getOrNull()

    private fun JsonObject.str(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.num(key: String): JsonPrimitive? =
        (this[key] as? JsonPrimitive)?.takeIf { !it.isString }

    private fun point(p: JsonObject): Point? {
        val id = p.num("id")?.intOrNull ?: return null
        val x = p.num("x")?.floatOrNull?.takeIf { it.isFinite() } ?: return null
        val y = p.num("y")?.floatOrNull?.takeIf { it.isFinite() } ?: return null
        return Point(id, x, y)
    }

    fun state(capturing: Boolean, accessibility: Boolean, captureW: Int, captureH: Int): String = encode(buildJsonObject {
        put("t", "state")
        put("capturing", capturing)
        put("accessibility", accessibility)
        put("capture", buildJsonObject {
            put("w", captureW)
            put("h", captureH)
        })
    })

    fun answer(sdp: String): String = encode(buildJsonObject {
        put("t", "answer")
        put("sdp", sdp)
    })

    fun ice(candidate: JsonObject): String = encode(buildJsonObject {
        put("t", "ice")
        put("candidate", candidate)
    })

    private fun encode(o: JsonObject) = json.encodeToString(JsonObject.serializer(), o)
}
