/** @typedef {{ key: boolean, ptsUs: number, data: Uint8Array }} VideoFrame */

const HEADER_BYTES = 16;
export const MAX_PENDING_SEGMENTS = 15;

/**
 * @param {ArrayBuffer} buf
 * @returns {VideoFrame | null} null for truncated or unknown-version messages
 */
export function parseFrame(buf) {
  if (buf.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== 1) return null;
  return {
    key: (view.getUint8(1) & 1) !== 0,
    ptsUs: Number(view.getBigUint64(4, true)),
    data: new Uint8Array(buf, HEADER_BYTES),
  };
}

/** Lets only a keyframe start (or restart) the stream; a backlog of pending segments re-arms it. */
export function createKeyGate() {
  let armed = true;
  return {
    /**
     * @param {boolean} key
     * @param {number} queueSize media segments waiting to be appended
     * @returns {boolean} whether to feed this frame to the decoder
     */
    accept(key, queueSize) {
      if (key) {
        armed = false;
        return true;
      }
      if (armed) return false;
      if (queueSize > MAX_PENDING_SEGMENTS) {
        armed = true;
        return false;
      }
      return true;
    },
  };
}
