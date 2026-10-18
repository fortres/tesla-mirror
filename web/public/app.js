import { connect } from './ws.js';
import { startPeer } from './peer.js';
import { videoBox, normalize, snapshot, createCoalescer } from './touch.js';
import { createDebug } from './debug.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const debug = createDebug($('debug'));

let ws = null;
let peer = null;
let capture = null;
let box = videoBox(innerWidth, innerHeight, 1);
let latestPts = [];
let heartbeat = null;
let peerGen = 0;
const startedInside = new Set();
const panelIds = new Set();
const WAITING_HINT = $('hint').textContent;

const sendJson = (obj) => ws && ws.send(JSON.stringify(obj));
const sendTouch = (pts) => {
  debug.touch(pts);
  sendJson({ t: 'touch', pts });
};
const coalescer = createCoalescer(sendTouch, requestAnimationFrame);

function updateBox() {
  let aspect = 0;
  if (video.videoWidth > 0 && video.videoHeight > 0) aspect = video.videoWidth / video.videoHeight;
  else if (capture) aspect = capture.w / capture.h;
  if (aspect > 0) box = videoBox(innerWidth, innerHeight, aspect);
}

function setHint(text) {
  $('hint').hidden = text === null;
  if (text !== null) $('hint').textContent = text;
}

function closePeer() {
  peerGen++;
  debug.unwatch();
  if (peer) {
    peer.close();
    peer = null;
  }
}

function beginPeer() {
  const gen = ++peerGen;
  setHint('Waiting for first frame — move something on the phone');
  const onFrame = () => {
    if (gen === peerGen) setHint(null);
  };
  peer = startPeer({
    send: sendJson,
    onState: debug.set,
    onTrack: (stream) => {
      video.srcObject = stream;
      video.play().catch(() => {});
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
      else video.addEventListener('playing', onFrame, { once: true });
      debug.watch(peer.pc);
    },
    onFailed: () => {
      closePeer();
      ws.close();
      start();
    },
  });
}

function onState(msg) {
  if (!msg.capturing) setHint(WAITING_HINT);
  $('a11y').hidden = msg.accessibility !== false;
  capture = msg.capture;
  updateBox();
  debug.set('capturing', msg.capturing);
  if (msg.capturing && !peer) beginPeer();
  else if (!msg.capturing && peer) closePeer();
}

function start() {
  const mine = (ws = connect({
    url: `ws://${location.host}/ws`,
    onOpen: () => debug.set('ws', 'open'),
    onClose: () => {
      if (ws !== mine) return;
      debug.set('ws', 'closed');
      closePeer();
      setHint('Reconnecting…');
      $('a11y').hidden = true;
    },
    onMessage: (msg) => {
      if (ws !== mine) return;
      if (msg.t === 'state') onState(msg);
      else if (peer && (msg.t === 'answer' || msg.t === 'ice')) peer.handle(msg);
    },
  }));
}

function onTouch(e) {
  const ended = e.type === 'touchend' || e.type === 'touchcancel';
  let relevant = false;
  for (const t of e.changedTouches) {
    if (e.type === 'touchstart') {
      startedInside.delete(t.identifier);
      panelIds.delete(t.identifier);
      if (t.target.closest('#panel')) panelIds.add(t.identifier);
      else if (normalize(t.clientX, t.clientY, box)) startedInside.add(t.identifier);
    }
    if (!panelIds.has(t.identifier)) relevant = true;
  }
  if (ended) for (const t of e.changedTouches) panelIds.delete(t.identifier);
  if (e.touches.length === 0) {
    startedInside.clear();
    panelIds.clear();
  }
  if (!relevant) return;
  e.preventDefault();
  const wasDown = latestPts.length > 0;
  latestPts = snapshot(e.touches, box, startedInside);
  if (ended) for (const t of e.changedTouches) startedInside.delete(t.identifier);
  if (latestPts.length === 0) {
    clearInterval(heartbeat);
    heartbeat = null;
    if (wasDown) {
      coalescer.push([]); // a pending frame must not send a stale snapshot after the release
      sendTouch([]);
    }
    return;
  }
  if (!heartbeat)
    heartbeat = setInterval(() => {
      if (latestPts.length > 0) sendTouch(latestPts);
    }, 100);
  coalescer.push(latestPts);
}

for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
  document.addEventListener(type, onTouch, { passive: false });
}

document
  .querySelectorAll('[data-key]')
  .forEach((b) => b.addEventListener('click', () => sendJson({ t: 'key', k: b.dataset.key })));
$('debugToggle').addEventListener('click', () => {
  $('debug').hidden = !$('debug').hidden;
});

addEventListener('resize', updateBox);
video.addEventListener('resize', updateBox);

start();
