/** @import { Box, Point } from './types.js' */

/**
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} aspect width / height of the video
 * @returns {Box} largest box of that aspect centered in the viewport
 */
export function videoBox(viewportW, viewportH, aspect) {
  let w = viewportW;
  let h = w / aspect;
  if (h > viewportH) {
    h = viewportH;
    w = h * aspect;
  }
  return { x: (viewportW - w) / 2, y: (viewportH - h) / 2, w, h };
}

/** @param {number} v */
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * @param {number} clientX
 * @param {number} clientY
 * @param {Box} box
 * @returns {{ x: number, y: number } | null} null when the point is outside the box
 */
export function normalize(clientX, clientY, box) {
  const x = (clientX - box.x) / box.w;
  const y = (clientY - box.y) / box.h;
  // A small tolerance keeps edge touches; far-outside points (letterbox) are ignored.
  if (x < -1e-6 || x > 1 + 1e-6 || y < -1e-6 || y > 1 + 1e-6) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

/**
 * @param {number} clientX
 * @param {number} clientY
 * @param {Box} box
 * @returns {{ x: number, y: number }}
 */
export function clampNormalize(clientX, clientY, box) {
  return { x: clamp01((clientX - box.x) / box.w), y: clamp01((clientY - box.y) / box.h) };
}

/**
 * @param {Iterable<{ identifier: number, clientX: number, clientY: number }>} touches
 * @param {Box} box
 * @param {Set<number>} startedInside identifiers of touches that began inside the box; others are ignored for life
 * @returns {Point[]}
 */
export function snapshot(touches, box, startedInside) {
  /** @type {Point[]} */
  const pts = [];
  for (const t of touches) {
    if (!startedInside.has(t.identifier)) continue;
    const p = clampNormalize(t.clientX, t.clientY, box);
    pts.push({ id: t.identifier, x: p.x, y: p.y });
  }
  return pts;
}

/**
 * @param {(pts: Point[]) => void} send
 * @param {(flush: () => void) => void} schedule
 */
export function createCoalescer(send, schedule) {
  /** @type {Point[]} */
  let latest = [];
  let pending = false;
  function flush() {
    pending = false;
    send(latest);
  }
  return {
    /** @param {Point[]} pts */
    push(pts) {
      latest = pts;
      if (!pending) {
        pending = true;
        schedule(flush);
      }
    },
  };
}
