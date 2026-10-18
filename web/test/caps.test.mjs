import test from 'node:test';
import assert from 'node:assert/strict';
import { transportOf } from '../public/caps.js';

const base = /** @type {const} */ ({
  t: 'state',
  capturing: true,
  accessibility: true,
  capture: { w: 1, h: 1 },
});

test('transportOf defaults to webrtc with touch for older phones', () => {
  assert.deepEqual(transportOf(base), { transport: 'webrtc', touch: true });
});

test('transportOf returns the announced values', () => {
  assert.deepEqual(transportOf({ ...base, transport: 'h264ws', touch: false }), {
    transport: 'h264ws',
    touch: false,
  });
});
