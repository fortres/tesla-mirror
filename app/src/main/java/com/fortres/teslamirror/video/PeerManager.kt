package com.fortres.teslamirror.video

import android.util.Log
import com.fortres.teslamirror.net.Protocol
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "TeslaMirror"

private open class SdpAdapter(private val what: String) : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) { Log.w(TAG, "$what create failed: $error") }
    override fun onSetFailure(error: String?) { Log.w(TAG, "$what set failed: $error") }
}

class PeerManager(private val track: VideoTrack, private val signal: (String) -> Unit) {
    private val pc: PeerConnection
    private val lock = Any()
    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteSet = false
    private val closed = AtomicBoolean(false)

    init {
        val config = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
        }
        pc = Rtc.factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                if (closed.get()) return
                signal(Protocol.ice(buildJsonObject {
                    put("candidate", c.sdp)
                    put("sdpMid", c.sdpMid)
                    put("sdpMLineIndex", c.sdpMLineIndex)
                }))
            }
            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                Log.i(TAG, "connection: $state")
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                Log.i(TAG, "ice: $state")
            }
            override fun onSignalingChange(state: PeerConnection.SignalingState) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: org.webrtc.MediaStream) {}
            override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
            override fun onDataChannel(channel: org.webrtc.DataChannel) {}
            override fun onRenegotiationNeeded() {}
        }) ?: error("createPeerConnection failed")
    }

    // No pc call is made while holding `lock`: pc.close()/dispose() block on the signaling thread.
    fun onOffer(sdp: String) {
        if (closed.get()) return
        pc.setRemoteDescription(object : SdpAdapter("setRemote") {
            override fun onSetSuccess() = onRemoteSet()
        }, SessionDescription(SessionDescription.Type.OFFER, sdp))
    }

    private fun onRemoteSet() {
        if (closed.get()) return
        val queued = synchronized(lock) {
            remoteSet = true
            pendingIce.toList().also { pendingIce.clear() }
        }
        queued.forEach { if (!closed.get()) pc.addIceCandidate(it) }

        val sender = pc.addTrack(track)
        val caps = Rtc.factory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs
        if (caps.any { it.name.equals("H264", ignoreCase = true) }) {
            val ordered = caps.sortedBy { if (it.name.equals("H264", ignoreCase = true)) 0 else 1 }
            pc.transceivers.firstOrNull { it.sender.id() == sender.id() }?.setCodecPreferences(ordered)
        }
        val params = sender.parameters
        params.encodings.getOrNull(0)?.maxBitrateBps = MAX_BITRATE_BPS
        if (!sender.setParameters(params)) Log.w(TAG, "setParameters rejected")

        if (closed.get()) return
        pc.createAnswer(object : SdpAdapter("createAnswer") {
            override fun onCreateSuccess(desc: SessionDescription) {
                if (closed.get()) return
                pc.setLocalDescription(object : SdpAdapter("setLocal") {
                    override fun onSetSuccess() {
                        if (closed.get()) return
                        Log.i(TAG, "video codec: ${firstVideoCodec(desc.description)}")
                        signal(Protocol.answer(desc.description))
                    }
                }, desc)
            }
        }, MediaConstraints())
    }

    private fun firstVideoCodec(sdp: String): String? =
        sdp.lineSequence().dropWhile { !it.startsWith("m=video") }.drop(1).takeWhile { !it.startsWith("m=") }
            .firstOrNull { it.startsWith("a=rtpmap:") }?.substringAfter(' ')?.trim()

    fun onRemoteIce(candidate: JsonObject) {
        if (closed.get()) return
        val line = (candidate["candidate"] as? JsonPrimitive)?.contentOrNull
        if (line.isNullOrEmpty()) return
        val mid = (candidate["sdpMid"] as? JsonPrimitive)?.contentOrNull
        val index = (candidate["sdpMLineIndex"] as? JsonPrimitive)?.intOrNull ?: 0
        val ice = IceCandidate(mid, index, line)
        val queued = synchronized(lock) {
            if (!remoteSet) pendingIce += ice
            !remoteSet
        }
        if (!queued) pc.addIceCandidate(ice)
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        pc.close()
        pc.dispose()
    }

    companion object {
        const val MAX_BITRATE_BPS = 4_000_000
    }
}
