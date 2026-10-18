/** @import { Point } from './types.js' */

/** @param {HTMLElement} el */
export function createDebug(el) {
  /** @type {Record<string, string | number | boolean>} */
  const values = {};
  /** @type {string[]} */
  const touches = [];
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  function render() {
    const kv = Object.entries(values).map(([k, v]) => `${k}: ${v}`);
    el.textContent = [...kv, '', ...touches].join('\n');
  }

  return {
    /**
     * @param {string} key
     * @param {string | number | boolean} value
     */
    set(key, value) {
      values[key] = value;
      render();
    },
    /** @param {Point[]} pts */
    touch(pts) {
      touches.push(JSON.stringify(pts));
      if (touches.length > 5) touches.shift();
      render();
    },
    unwatch() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** @param {RTCPeerConnection} pc */
    watch(pc) {
      this.unwatch();
      /** @type {number | null} */
      let lastBytes = null;
      timer = setInterval(async () => {
        let stats;
        try {
          stats = await pc.getStats();
        } catch {
          return;
        }
        stats.forEach((r) => {
          if (r.type !== 'inbound-rtp' || r.kind !== 'video') return;
          values.fps = r.framesPerSecond ?? 0;
          if (lastBytes !== null)
            values.kbps = Math.round(((r.bytesReceived - lastBytes) * 8) / 1000);
          lastBytes = r.bytesReceived;
        });
        render();
      }, 1000);
    },
  };
}
