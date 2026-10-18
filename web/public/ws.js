/** @import { InboundMsg } from './types.js' */

/**
 * @param {number} prevMs
 * @returns {number}
 */
export function nextBackoff(prevMs) {
  return Math.min(prevMs * 2, 5000);
}

/**
 * @param {object} options
 * @param {string} options.url
 * @param {() => void} [options.onOpen]
 * @param {(msg: InboundMsg) => void} [options.onMessage]
 * @param {() => void} [options.onClose]
 * @param {(prevMs: number) => number} [options.backoff]
 */
export function connect({ url, onOpen, onMessage, onClose, backoff = nextBackoff }) {
  /** @type {WebSocket | null} */
  let socket = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let stopped = false;
  let delay = 1000;

  function open() {
    timer = null;
    const s = (socket = new WebSocket(url));
    s.onopen = () => {
      delay = 1000;
      onOpen && onOpen();
    };
    s.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage && onMessage(msg);
    };
    s.onclose = () => {
      onClose && onClose();
      if (stopped || timer) return;
      timer = setTimeout(open, delay);
      delay = backoff(delay);
    };
  }
  open();

  return {
    /** @param {string} text */
    send(text) {
      if (socket && socket.readyState === 1) socket.send(text);
    },
    close() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (socket) socket.close();
    },
  };
}
