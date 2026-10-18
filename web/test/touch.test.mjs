import test from 'node:test';
import assert from 'node:assert/strict';
import { videoBox, normalize, snapshot, createCoalescer } from '../public/touch.js';
test('videoBox letterboxes a wide video in a tall viewport', () =>
  assert.deepEqual(videoBox(1000, 1000, 2), { x: 0, y: 250, w: 1000, h: 500 }));
test('videoBox pillarboxes a tall video in a wide viewport', () =>
  assert.deepEqual(videoBox(1000, 500, 1), { x: 250, y: 0, w: 500, h: 500 }));
test('normalize maps inside the box', () =>
  assert.deepEqual(normalize(500, 500, { x: 0, y: 250, w: 1000, h: 500 }), { x: 0.5, y: 0.5 }));
test('normalize returns null outside the box', () =>
  assert.equal(normalize(10, 10, { x: 0, y: 250, w: 1000, h: 500 }), null));
test('snapshot drops touches outside the box', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(
    snapshot(
      [
        { identifier: 3, clientX: 50, clientY: 50 },
        { identifier: 4, clientX: 150, clientY: 50 },
      ],
      box,
      new Set([3]),
    ),
    [{ id: 3, x: 0.5, y: 0.5 }],
  );
});
test('snapshot keeps a tracked touch that left the box, clamped', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(snapshot([{ identifier: 3, clientX: 150, clientY: 50 }], box, new Set([3])), [
    { id: 3, x: 1, y: 0.5 },
  ]);
});
test('coalescer sends only the latest snapshot per frame', () => {
  /** @type {import('../public/types.js').Point[][]} */
  const sent = [];
  /** @type {(() => void) | undefined} */
  let pending;
  const c = createCoalescer(
    (p) => sent.push(p),
    (fn) => {
      pending = fn;
    },
  );
  c.push([{ id: 0, x: 0.1, y: 0.1 }]);
  c.push([{ id: 0, x: 0.2, y: 0.2 }]);
  assert.equal(sent.length, 0);
  assert.ok(pending);
  pending();
  assert.deepEqual(sent, [[{ id: 0, x: 0.2, y: 0.2 }]]);
});
