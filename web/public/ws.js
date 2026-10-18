export function nextBackoff(prevMs) {
  return Math.min(prevMs * 2, 5000);
}

export function connect({ url, onOpen, onMessage, onClose, backoff = nextBackoff }) {
  let socket = null;
  let timer = null;
  let stopped = false;
  let delay = 1000;

  function open() {
    timer = null;
    socket = new WebSocket(url);
    socket.onopen = () => {
      delay = 1000;
      onOpen && onOpen();
    };
    socket.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage && onMessage(msg);
    };
    socket.onclose = () => {
      onClose && onClose();
      if (stopped || timer) return;
      timer = setTimeout(open, delay);
      delay = backoff(delay);
    };
  }
  open();

  return {
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
