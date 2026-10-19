import test from 'node:test';
import assert from 'node:assert/strict';
import { splitNalus, codecFromSps, initSegment, mediaSegment } from '../public/fmp4.js';

/**
 * @param {Uint8Array} buf
 * @returns {{ type: string, start: number, end: number }[]}
 */
function boxes(buf, from = 0, to = buf.length) {
  const out = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = from;
  while (at < to) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
    out.push({ type, start: at, end: at + size });
    at += size;
  }
  return out;
}

/**
 * @param {Uint8Array} buf
 * @param {string[]} path
 */
function find(buf, path) {
  let range = { start: 0, end: buf.length };
  let found = { type: '', start: 0, end: 0 };
  for (const name of path) {
    const hit = boxes(buf, range.start, range.end).find((b) => b.type === name);
    assert.ok(hit, `missing ${name}`);
    found = hit;
    range = { start: hit.start + 8, end: hit.end };
  }
  return found;
}

test('splitNalus handles 3- and 4-byte start codes', () => {
  const data = Uint8Array.of(0, 0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 2, 0, 0, 0, 1, 0x65, 3, 4);
  assert.deepEqual(
    splitNalus(data).map((n) => [...n]),
    [
      [0x67, 1],
      [0x68, 2],
      [0x65, 3, 4],
    ],
  );
});

test('codecFromSps', () => {
  assert.equal(codecFromSps(Uint8Array.of(0x67, 0x4d, 0x40, 0x1f, 0xaa)), 'avc1.4d401f');
});

test('initSegment box layout', () => {
  const sps = Uint8Array.of(0x67, 0x4d, 0x40, 0x1f, 0xaa);
  const pps = Uint8Array.of(0x68, 0xee, 0x3c);
  const init = initSegment({ sps, pps, width: 640, height: 1280 });
  assert.deepEqual(
    boxes(init).map((b) => b.type),
    ['ftyp', 'moov'],
  );
  const text = String.fromCharCode(...init);
  const body = text.indexOf('avcC') + 4;
  const expected = [1, 0x4d, 0x40, 0x1f, 0xff, 0xe1, 0, 5, ...sps, 1, 0, 3, ...pps];
  assert.deepEqual([...init.subarray(body, body + expected.length)], expected);
  const tkhd = find(init, ['moov', 'trak', 'tkhd']);
  const view = new DataView(init.buffer);
  assert.equal(view.getUint32(tkhd.end - 8), 640 << 16);
  const mvhd = find(init, ['moov', 'mvhd']);
  for (const [at, first] of [
    [mvhd.start + 12 + 32, 0],
    [tkhd.start + 12 + 36, 0],
  ]) {
    assert.equal(view.getUint32(at + first), 0x00010000);
    assert.equal(view.getUint32(at + 32), 0x40000000);
  }
  assert.equal(view.getUint32(tkhd.end - 4), 1280 << 16);
});

test('mediaSegment sample data and flags', () => {
  const seg = mediaSegment({
    seq: 7,
    decodeTimeUs: 1_000_000,
    durationUs: 33_333,
    key: true,
    nalus: [Uint8Array.of(0x09, 0xf0), Uint8Array.of(0x65, 1, 2, 3)],
  });
  assert.deepEqual(
    boxes(seg).map((b) => b.type),
    ['moof', 'mdat'],
  );
  const [moof, mdat] = boxes(seg);
  assert.deepEqual([...seg.subarray(mdat.start + 8, mdat.end)], [0, 0, 0, 4, 0x65, 1, 2, 3]);
  const view = new DataView(seg.buffer);
  const mfhd = find(seg, ['moof', 'mfhd']);
  assert.equal(view.getUint32(mfhd.start + 12), 7);
  const tfdt = find(seg, ['moof', 'traf', 'tfdt']);
  assert.equal(view.getUint8(tfdt.start + 8), 1);
  assert.equal(view.getBigUint64(tfdt.start + 12), 1_000_000n);
  const trun = find(seg, ['moof', 'traf', 'trun']);
  const t = trun.start + 12; // after size, type, version/flags
  assert.equal(view.getUint32(t), 1);
  assert.equal(view.getInt32(t + 4), moof.end - moof.start + 8);
  assert.equal(view.getUint32(t + 8), 33_333);
  assert.equal(view.getUint32(t + 12), 8);
  assert.equal(view.getUint32(t + 16), 0x02000000);
});
