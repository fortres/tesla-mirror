export function videoBox(viewportW, viewportH, aspect) {
  let w = viewportW;
  let h = w / aspect;
  if (h > viewportH) { h = viewportH; w = h * aspect; }
  return { x: (viewportW - w) / 2, y: (viewportH - h) / 2, w, h };
}

const clamp01 = v => Math.min(1, Math.max(0, v));

export function normalize(clientX, clientY, box) {
  const x = (clientX - box.x) / box.w;
  const y = (clientY - box.y) / box.h;
  // A small tolerance keeps edge touches; far-outside points (letterbox) are ignored.
  if (x < -1e-6 || x > 1 + 1e-6 || y < -1e-6 || y > 1 + 1e-6) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

export function clampNormalize(clientX, clientY, box) {
  return { x: clamp01((clientX - box.x) / box.w), y: clamp01((clientY - box.y) / box.h) };
}

// startedInside: identifiers of touches that began inside the box; others are ignored for life.
export function snapshot(touches, box, startedInside) {
  const pts = [];
  for (const t of touches) {
    if (!startedInside.has(t.identifier)) continue;
    const p = clampNormalize(t.clientX, t.clientY, box);
    pts.push({ id: t.identifier, x: p.x, y: p.y });
  }
  return pts;
}

export function createCoalescer(send, schedule) {
  let latest = null;
  let pending = false;
  function flush() {
    pending = false;
    send(latest);
  }
  return {
    push(pts) {
      latest = pts;
      if (!pending) { pending = true; schedule(flush); }
    },
    flush,
  };
}
