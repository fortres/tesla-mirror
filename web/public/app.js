import { connect } from './ws.js';
import { startPeer } from './peer.js';
import { videoBox, normalize, snapshot, createCoalescer } from './touch.js';
import { createDebug } from './debug.js';
import { transportOf } from './caps.js';
import { startH264, h264Supported } from './h264.js';

/** @import { InboundMsg, OutboundMsg, Point, StateMsg } from './types.js' */

/**
 * @template {Element} T
 * @param {string} id
 * @returns {T}
 */
function must(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return /** @type {T} */ (/** @type {unknown} */ (el));
}

/**
 * @template {Element} T
 * @param {ParentNode} parent
 * @param {string} selector
 * @returns {T}
 */
function mustQuery(parent, selector) {
  const el = parent.querySelector(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return /** @type {T} */ (/** @type {unknown} */ (el));
}

/** @type {HTMLVideoElement} */
const video = must('video');
/** @type {HTMLVideoElement} */
const stream = must('stream');
/** @type {HTMLElement} */
const hint = must('hint');
/** @type {HTMLElement} */
const hintTitle = mustQuery(hint, '.hint-title');
/** @type {HTMLElement} */
const hintText = mustQuery(hint, '.hint-text');
/** @type {HTMLElement} */
const a11y = must('a11y');
/** @type {HTMLElement} */
const debugEl = must('debug');
/** @type {HTMLElement} */
const debugToggle = must('debugToggle');
const debug = createDebug(debugEl);
const keyButtons = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-key]'));

/** @type {ReturnType<typeof connect> | null} */
let ws = null;
/** @type {ReturnType<typeof startPeer> | null} */
let peer = null;
/** @type {StateMsg['capture'] | null} */
let capture = null;
let box = videoBox(innerWidth, innerHeight, 1);
/** @type {Point[]} */
let latestPts = [];
/** @type {ReturnType<typeof setInterval> | null} */
let heartbeat = null;
let peerGen = 0;
/** @type {string | null} Last transport the phone announced; decides the hint when the socket drops. */
let lastTransport = null;
/** @type {ReturnType<typeof startH264> | null} */
let h264 = null;
let h264Gen = 0;
/** @type {ReturnType<typeof setInterval> | null} */
let latencyTimer = null;
let touchEnabled = true;
/** @type {boolean | null} */
let decoderSupported = null;
/** @type {Set<number>} */
const startedInside = new Set();
/** @type {Set<number>} */
const panelIds = new Set();
const WAITING_HINT = /** @type {string} */ (hintTitle.textContent);

/** @param {OutboundMsg} obj */
const sendJson = (obj) => ws && ws.send(JSON.stringify(obj));
/** @param {Point[]} pts */
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

/**
 * @param {string | null} title null hides the hint
 * @param {string} [text] secondary line
 */
function setHint(title, text = '') {
  hint.hidden = title === null;
  if (title === null) return;
  hintTitle.textContent = title;
  hintText.textContent = text;
  hintText.hidden = text === '';
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
  setHint('Waiting for first frame', 'Move something on the phone');
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
      if (peer) debug.watch(peer.pc);
    },
    onFailed: () => {
      closePeer();
      if (ws) ws.close();
      start();
    },
  });
}

function closeH264() {
  h264Gen++;
  if (latencyTimer) clearInterval(latencyTimer);
  latencyTimer = null;
  if (h264) {
    h264.close();
    h264 = null;
  }
}

function beginH264() {
  const gen = ++h264Gen;
  setHint('Waiting for first frame', 'Move something on the phone');
  h264 = startH264({
    video: stream,
    getSize: () => capture ?? { w: 1, h: 1 },
    onFirstFrame: () => {
      if (gen === h264Gen) setHint(null);
    },
    onStat: (stat) => {
      if (gen !== h264Gen) return;
      debug.set('dropped', stat.dropped);
      debug.set('appended', stat.appended);
    },
  });
  latencyTimer = setInterval(() => {
    const b = stream.buffered;
    if (b.length > 0) debug.set('latency', (b.end(b.length - 1) - stream.currentTime).toFixed(2));
  }, 1000);
}

/** @param {StateMsg} msg */
function onState(msg) {
  const { transport, touch } = transportOf(msg);
  const h264ws = transport === 'h264ws';
  lastTransport = transport;
  touchEnabled = touch;
  if (!touch) {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    latestPts = [];
  }
  stream.hidden = !h264ws;
  video.hidden = h264ws;
  keyButtons.forEach((b) => (b.hidden = !touch));
  if (!msg.capturing) setHint(WAITING_HINT);
  a11y.hidden = msg.accessibility || !touch;
  capture = msg.capture;
  updateBox();
  debug.set('transport', transport);
  debug.set('capturing', msg.capturing);
  if (h264ws) {
    if (peer) closePeer();
    if (decoderSupported === null) {
      decoderSupported = h264Supported();
      debug.set('decoder', decoderSupported ? 'yes' : 'no');
    }
    if (!msg.capturing) closeH264();
    else if (!decoderSupported)
      setHint('Browser cannot play the iPhone stream', 'Use the Android phone or update the car');
    else if (!h264) beginH264();
    return;
  }
  closeH264();
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
      closeH264();
      if (lastTransport === 'h264ws')
        setHint('Reconnecting…', 'If it does not come back, start the broadcast on the iPhone');
      else setHint('Reconnecting…');
      a11y.hidden = true;
    },
    onBinary: (buf) => {
      if (ws === mine && h264) h264.push(buf);
    },
    /** @param {InboundMsg} msg */
    onMessage: (msg) => {
      if (ws !== mine) return;
      if (msg.t === 'state') onState(msg);
      else if (peer && (msg.t === 'answer' || msg.t === 'ice')) peer.handle(msg);
    },
  }));
}

/** @param {TouchEvent} e */
function onTouch(e) {
  if (!touchEnabled) return;
  const ended = e.type === 'touchend' || e.type === 'touchcancel';
  let relevant = false;
  for (const t of e.changedTouches) {
    if (e.type === 'touchstart') {
      startedInside.delete(t.identifier);
      panelIds.delete(t.identifier);
      if (t.target instanceof Element && t.target.closest('#panel')) panelIds.add(t.identifier);
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
    if (heartbeat) clearInterval(heartbeat);
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
  document.addEventListener(type, (e) => onTouch(/** @type {TouchEvent} */ (e)), {
    passive: false,
  });
}

keyButtons.forEach((b) =>
  b.addEventListener('click', () => sendJson({ t: 'key', k: b.dataset.key ?? '' })),
);
debugToggle.addEventListener('click', () => {
  debugEl.hidden = !debugEl.hidden;
  debugToggle.classList.toggle('is-active', !debugEl.hidden);
});

addEventListener('resize', updateBox);
video.addEventListener('resize', updateBox);

start();
