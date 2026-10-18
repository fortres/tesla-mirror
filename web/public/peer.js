/** @import { AnswerMsg, IceMsg, OutboundMsg } from './types.js' */

const NEGOTIATION_TIMEOUT_MS = 15000;

/**
 * @param {object} options
 * @param {(msg: OutboundMsg) => void} options.send
 * @param {(stream: MediaStream) => void} options.onTrack
 * @param {() => void} options.onFailed
 * @param {(key: string, value: string) => void} options.onState
 */
export function startPeer({ send, onTrack, onFailed, onState }) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  /** @type {RTCIceCandidateInit[]} */
  const queued = [];
  let remoteSet = false;
  let done = false;
  const timer = setTimeout(() => fail(), NEGOTIATION_TIMEOUT_MS);

  function fail() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    onFailed();
  }

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = (e) => onTrack(e.streams[0] || new MediaStream([e.track]));
  pc.onicecandidate = (e) => {
    if (e.candidate) send({ t: 'ice', candidate: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    onState('pc', pc.connectionState);
    if (pc.connectionState === 'connected') clearTimeout(timer);
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) fail();
  };
  pc.oniceconnectionstatechange = () => onState('ice', pc.iceConnectionState);

  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => {
      if (!pc.localDescription) throw new Error('no local description');
      send({ t: 'offer', sdp: pc.localDescription.sdp });
    })
    .catch(fail);

  return {
    pc,
    /** @param {AnswerMsg | IceMsg} msg */
    handle(msg) {
      if (msg.t === 'answer') {
        pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
          .then(() => {
            remoteSet = true;
            queued.splice(0).forEach((c) => pc.addIceCandidate(c).catch(() => {}));
          })
          .catch(fail);
      } else if (msg.t === 'ice') {
        if (remoteSet) pc.addIceCandidate(msg.candidate).catch(() => {});
        else queued.push(msg.candidate);
      }
    },
    close() {
      done = true;
      clearTimeout(timer);
      pc.close();
    },
  };
}
