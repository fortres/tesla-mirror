import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrame, createKeyGate } from '../public/frame.js';

const header = [0x01, 0x01, 0x00, 0x00, 0x40, 0x42, 0x0f, 0x00, 0, 0, 0, 0, 0, 0, 0, 0];

test('parseFrame reads the golden header', () => {
  const payload = [0, 0, 0, 1, 0x65];
  const buf = new Uint8Array([...header, ...payload]).buffer;
  const frame = parseFrame(buf);
  assert.ok(frame);
  assert.equal(frame.key, true);
  assert.equal(frame.ptsUs, 1000000);
  assert.deepEqual([...frame.data], payload);
});

test('parseFrame rejects short and wrong-version buffers', () => {
  assert.equal(parseFrame(new Uint8Array(15).buffer), null);
  assert.equal(parseFrame(new Uint8Array([2, ...header.slice(1)]).buffer), null);
});

test('key gate waits for the first keyframe', () => {
  const gate = createKeyGate();
  assert.equal(gate.accept(false, 0), false);
  assert.equal(gate.accept(true, 0), true);
  assert.equal(gate.accept(false, 0), true);
});

test('key gate drops to the next keyframe on backlog', () => {
  const gate = createKeyGate();
  gate.accept(true, 0);
  assert.equal(gate.accept(false, 3), false);
  assert.equal(gate.accept(false, 0), false);
  assert.equal(gate.accept(true, 0), true);
});
