import { parseFrame, createKeyGate } from './frame.js';
import { splitNalus, codecFromSps, initSegment, mediaSegment } from './fmp4.js';

const DEFAULT_CODEC = 'avc1.4D401F';
const FRAME_US = 33_333;
const MAX_FRAME_US = 100_000;
const STAT_INTERVAL_MS = 1000;
const TRIM_INTERVAL_MS = 5000;
const KEEP_BEHIND_S = 10;
const LIVE_LAG_S = 0.3;
const LIVE_SEEK_BACK_S = 0.05;
const NAL_SPS = 7;
const NAL_PPS = 8;

/** @typedef {{ dropped: number, decoded: number }} H264Stat */

/** @param {string} [codec] */
export function h264Supported(codec = DEFAULT_CODEC) {
  return (
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`)
  );
}

/**
 * @param {Uint8Array | null} a
 * @param {Uint8Array | null} b
 */
function sameBytes(a, b) {
  return !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * @param {object} options
 * @param {HTMLVideoElement} options.video
 * @param {{ w: number, h: number }} options.size
 * @param {() => void} options.onFirstFrame
 * @param {(stat: H264Stat) => void} options.onStat
 */
export function startH264({ video, size, onFirstFrame, onStat }) {
  let gate = createKeyGate();
  let closed = false;
  let dropped = 0;
  let decoded = 0;
  let lastStatAt = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let statTimer = null;
  let lastTrimAt = 0;
  let firstShown = false;

  /** @type {MediaSource | null} */
  let ms = null;
  /** @type {SourceBuffer | null} */
  let sb = null;
  /** @type {string | null} */
  let objectUrl = null;
  /** @type {Uint8Array | null} */
  let curSps = null;
  /** @type {Uint8Array<ArrayBuffer>[]} */
  let queue = [];
  let seq = 0;
  let nextDecodeUs = 0;
  /** @type {{ ptsUs: number, key: boolean, nalus: Uint8Array[] } | null} */
  let prev = null;

  function emitStat() {
    if (statTimer) clearTimeout(statTimer);
    statTimer = null;
    lastStatAt = performance.now();
    onStat({ dropped, decoded });
  }

  function statChanged() {
    const wait = STAT_INTERVAL_MS - (performance.now() - lastStatAt);
    if (wait <= 0) emitStat();
    else if (!statTimer) statTimer = setTimeout(emitStat, wait);
  }

  function teardown() {
    const old = ms;
    ms = null;
    sb = null;
    queue = [];
    prev = null;
    curSps = null;
    if (old && objectUrl) {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
    objectUrl = null;
  }

  function fail() {
    teardown();
    gate = createKeyGate();
  }

  function pump() {
    if (!sb || sb.updating || closed) return;
    const next = queue.shift();
    if (!next) return;
    try {
      sb.appendBuffer(next);
    } catch {
      fail();
      return;
    }
    decoded++;
    statChanged();
  }

  function onUpdateEnd() {
    if (closed || !sb) return;
    const { buffered } = video;
    if (buffered.length > 0) {
      const end = buffered.end(buffered.length - 1);
      if (end - video.currentTime > LIVE_LAG_S) video.currentTime = end - LIVE_SEEK_BACK_S;
    }
    video.play().catch(() => {});
    const now = performance.now();
    if (now - lastTrimAt >= TRIM_INTERVAL_MS && video.currentTime > KEEP_BEHIND_S) {
      lastTrimAt = now;
      try {
        sb.remove(0, video.currentTime - KEEP_BEHIND_S);
        return;
      } catch {
        fail();
        return;
      }
    }
    pump();
  }

  /**
   * @param {Uint8Array} sps
   * @param {Uint8Array} pps
   */
  function build(sps, pps) {
    teardown();
    curSps = sps;
    const source = new MediaSource();
    ms = source;
    objectUrl = URL.createObjectURL(source);
    const mime = `video/mp4; codecs="${codecFromSps(sps)}"`;
    queue = [initSegment({ sps, pps, width: size.w, height: size.h })];
    seq = 0;
    nextDecodeUs = 0;
    source.addEventListener(
      'sourceopen',
      () => {
        if (closed || ms !== source) return;
        try {
          const buffer = source.addSourceBuffer(mime);
          buffer.mode = 'segments';
          buffer.addEventListener('updateend', onUpdateEnd);
          buffer.addEventListener('error', () => {
            if (ms === source) fail();
          });
          sb = buffer;
        } catch {
          fail();
          return;
        }
        pump();
      },
      { once: true },
    );
    video.src = objectUrl;
  }

  /** @param {number} durationUs */
  function flushPrev(durationUs) {
    if (!prev) return;
    const durUs = Math.min(Math.max(durationUs, 1), MAX_FRAME_US);
    queue.push(
      mediaSegment({
        seq: ++seq,
        decodeTimeUs: nextDecodeUs,
        durationUs: durUs,
        key: prev.key,
        nalus: prev.nalus,
      }),
    );
    nextDecodeUs += durUs;
    prev = null;
  }

  function onPlaying() {
    if (firstShown || closed) return;
    firstShown = true;
    onFirstFrame();
  }
  video.addEventListener('playing', onPlaying);

  return {
    /** @param {ArrayBuffer} buf */
    push(buf) {
      if (closed) return;
      const frame = parseFrame(buf);
      if (!frame) return;
      if (!gate.accept(frame.key, queue.length)) {
        dropped++;
        statChanged();
        return;
      }
      const nalus = splitNalus(frame.data);
      if (frame.key) {
        const sps = nalus.find((n) => (n[0] & 0x1f) === NAL_SPS);
        const pps = nalus.find((n) => (n[0] & 0x1f) === NAL_PPS);
        if (!sps || !pps) {
          dropped++;
          statChanged();
          fail();
          return;
        }
        if (ms && sameBytes(sps, curSps)) flushPrev(frame.ptsUs - (prev?.ptsUs ?? 0));
        else build(sps, pps);
      } else if (prev) {
        flushPrev(frame.ptsUs - prev.ptsUs || FRAME_US);
      }
      prev = { ptsUs: frame.ptsUs, key: frame.key, nalus };
      pump();
    },
    close() {
      closed = true;
      video.removeEventListener('playing', onPlaying);
      if (statTimer) clearTimeout(statTimer);
      statTimer = null;
      teardown();
    },
  };
}
