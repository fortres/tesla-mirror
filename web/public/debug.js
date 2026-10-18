export function createDebug(el) {
  const values = {};
  const touches = [];
  let timer = null;

  function render() {
    const kv = Object.entries(values).map(([k, v]) => `${k}: ${v}`);
    el.textContent = [...kv, '', ...touches].join('\n');
  }

  return {
    set(key, value) { values[key] = value; render(); },
    touch(pts) {
      touches.push(JSON.stringify(pts));
      if (touches.length > 5) touches.shift();
      render();
    },
    unwatch() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    watch(pc) {
      this.unwatch();
      let lastBytes = null;
      timer = setInterval(async () => {
        let stats;
        try { stats = await pc.getStats(); } catch { return; }
        stats.forEach(r => {
          if (r.type !== 'inbound-rtp' || r.kind !== 'video') return;
          values.fps = r.framesPerSecond ?? 0;
          if (lastBytes !== null) values.kbps = Math.round((r.bytesReceived - lastBytes) * 8 / 1000);
          lastBytes = r.bytesReceived;
        });
        render();
      }, 1000);
    },
  };
}
