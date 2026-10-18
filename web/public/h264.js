import { parseFrame, createKeyGate } from './frame.js';

const DECODER_CONFIG = { codec: 'avc1.4D401F', optimizeForLatency: true };
const STAT_INTERVAL_MS = 1000;

/** @typedef {{ dropped?: number, decoded?: number, error?: string }} H264Stat */

export async function h264Supported() {
  if (typeof VideoDecoder === 'undefined') return false;
  try {
    return (await VideoDecoder.isConfigSupported(DECODER_CONFIG)).supported === true;
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {() => void} options.onFirstFrame
 * @param {(stat: H264Stat) => void} options.onStat
 */
export function startH264({ canvas, onFirstFrame, onStat }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  let gate = createKeyGate();
  let dropped = 0;
  let decoded = 0;
  let firstShown = false;
  let closed = false;
  let lastStatAt = 0;

  function reportStat() {
    const now = performance.now();
    if (now - lastStatAt < STAT_INTERVAL_MS) return;
    lastStatAt = now;
    onStat({ dropped, decoded });
  }

  function createDecoder() {
    const d = new VideoDecoder({
      output(frame) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx?.drawImage(frame, 0, 0);
        frame.close();
        decoded++;
        if (!firstShown) {
          firstShown = true;
          onFirstFrame();
        }
        reportStat();
      },
      error(e) {
        if (closed) return;
        onStat({ error: e.message });
        // An errored decoder is closed for good; replace it and wait for a keyframe.
        decoder = createDecoder();
        gate = createKeyGate();
      },
    });
    d.configure(DECODER_CONFIG);
    return d;
  }

  let decoder = createDecoder();

  return {
    /** @param {ArrayBuffer} buf */
    push(buf) {
      if (closed) return;
      const frame = parseFrame(buf);
      if (!frame) return;
      if (!gate.accept(frame.key, decoder.decodeQueueSize)) {
        dropped++;
        reportStat();
        return;
      }
      decoder.decode(
        new EncodedVideoChunk({
          type: frame.key ? 'key' : 'delta',
          timestamp: frame.ptsUs,
          data: frame.data,
        }),
      );
    },
    close() {
      closed = true;
      if (decoder.state !== 'closed') decoder.close();
    },
  };
}
