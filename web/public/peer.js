export function startPeer({ send, onTrack, onFailed, onState }) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const queued = [];
  let remoteSet = false;
  let done = false;

  function fail() {
    if (done) return;
    done = true;
    onFailed();
  }

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = e => onTrack(e.streams[0] || new MediaStream([e.track]));
  pc.onicecandidate = e => {
    if (e.candidate) send({ t: 'ice', candidate: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    onState('pc', pc.connectionState);
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) fail();
  };
  pc.oniceconnectionstatechange = () => onState('ice', pc.iceConnectionState);

  pc.createOffer()
    .then(offer => pc.setLocalDescription(offer))
    .then(() => send({ t: 'offer', sdp: pc.localDescription.sdp }))
    .catch(fail);

  return {
    pc,
    handle(msg) {
      if (msg.t === 'answer') {
        pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).then(() => {
          remoteSet = true;
          queued.splice(0).forEach(c => pc.addIceCandidate(c).catch(() => {}));
        }).catch(fail);
      } else if (msg.t === 'ice') {
        if (remoteSet) pc.addIceCandidate(msg.candidate).catch(() => {});
        else queued.push(msg.candidate);
      }
    },
    close() {
      done = true;
      pc.close();
    },
  };
}
