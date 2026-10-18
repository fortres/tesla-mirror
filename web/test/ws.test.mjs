import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBackoff } from '../public/ws.js';
test('backoff doubles and caps at 5 s', () => {
  assert.equal(nextBackoff(1000), 2000);
  assert.equal(nextBackoff(4000), 5000);
  assert.equal(nextBackoff(5000), 5000);
});
