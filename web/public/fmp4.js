const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_AUD = 9;

/**
 * @param {string} type four characters
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function box(type, ...parts) {
  let size = 8;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * @param {number} size
 * @param {(view: DataView) => void} [fill]
 * @returns {Uint8Array}
 */
function bytes(size, fill) {
  const out = new Uint8Array(size);
  if (fill) fill(new DataView(out.buffer));
  return out;
}

/**
 * @param {string} type
 * @param {number} version
 * @param {number} flags
 * @param {Uint8Array[]} parts
 */
function fullBox(type, version, flags, ...parts) {
  return box(
    type,
    bytes(4, (v) => v.setUint32(0, (version << 24) | flags)),
    ...parts,
  );
}

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

/** @param {Uint8Array} annexB */
export function splitNalus(annexB) {
  /** @type {Uint8Array[]} */
  const nalus = [];
  let start = -1;
  let i = 0;
  while (i + 2 < annexB.length) {
    if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 1) {
      if (start >= 0) pushNal(nalus, annexB, start, i);
      start = i + 3;
      i += 3;
    } else i++;
  }
  if (start >= 0) pushNal(nalus, annexB, start, annexB.length);
  return nalus;
}

/**
 * @param {Uint8Array[]} nalus
 * @param {Uint8Array} src
 * @param {number} from
 * @param {number} to end, possibly including the leading zero of the next 4-byte start code
 */
function pushNal(nalus, src, from, to) {
  let end = to;
  while (end > from && src[end - 1] === 0) end--;
  if (end > from) nalus.push(src.subarray(from, end));
}

/** @param {Uint8Array} sps */
export function codecFromSps(sps) {
  const hex = (/** @type {number} */ b) => b.toString(16).padStart(2, '0');
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}

/** @param {{ sps: Uint8Array, pps: Uint8Array, width: number, height: number, timescale?: number }} o */
export function initSegment({ sps, pps, width, height, timescale = 1_000_000 }) {
  const ftyp = box(
    'ftyp',
    bytes(24, (v) => {
      for (const [i, s] of ['isom', '', 'isom', 'iso6', 'avc1', 'mp41'].entries())
        for (let j = 0; j < s.length; j++) v.setUint8(i * 4 + j, s.charCodeAt(j));
    }),
  );
  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    bytes(96, (v) => {
      v.setUint32(8, timescale);
      v.setUint32(16, 0x00010000);
      v.setUint16(20, 0x0100);
      MATRIX.forEach((m, i) => v.setUint32(32 + i * 4, m));
      v.setUint32(92, 2);
    }),
  );
  const tkhd = fullBox(
    'tkhd',
    0,
    3,
    bytes(80, (v) => {
      v.setUint32(8, 1);
      MATRIX.forEach((m, i) => v.setUint32(36 + i * 4, m));
      v.setUint32(72, width << 16);
      v.setUint32(76, height << 16);
    }),
  );
  const mdhd = fullBox(
    'mdhd',
    0,
    0,
    bytes(20, (v) => {
      v.setUint32(8, timescale);
      v.setUint16(16, 0x55c4);
    }),
  );
  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    bytes(21, (v) => {
      for (let j = 0; j < 4; j++) v.setUint8(4 + j, 'vide'.charCodeAt(j));
    }),
  );
  const vmhd = fullBox('vmhd', 0, 1, bytes(8));
  const dinf = box(
    'dinf',
    fullBox(
      'dref',
      0,
      0,
      bytes(4, (v) => v.setUint32(0, 1)),
      fullBox('url ', 0, 1),
    ),
  );
  const avcC = box(
    'avcC',
    Uint8Array.of(1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 0xff),
    sps,
    Uint8Array.of(1, pps.length >> 8, pps.length & 0xff),
    pps,
  );
  const avc1 = box(
    'avc1',
    bytes(78, (v) => {
      v.setUint16(6, 1);
      v.setUint16(24, width);
      v.setUint16(26, height);
      v.setUint32(28, 0x00480000);
      v.setUint32(32, 0x00480000);
      v.setUint16(40, 1);
      v.setUint16(74, 0x0018);
      v.setInt16(76, -1);
    }),
    avcC,
  );
  const empty = bytes(4);
  const stbl = box(
    'stbl',
    fullBox(
      'stsd',
      0,
      0,
      bytes(4, (v) => v.setUint32(0, 1)),
      avc1,
    ),
    fullBox('stts', 0, 0, empty),
    fullBox('stsc', 0, 0, empty),
    fullBox('stsz', 0, 0, bytes(8)),
    fullBox('stco', 0, 0, empty),
  );
  const minf = box('minf', vmhd, dinf, stbl);
  const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
  const trex = fullBox(
    'trex',
    0,
    0,
    bytes(20, (v) => {
      v.setUint32(0, 1);
      v.setUint32(4, 1);
    }),
  );
  return concat([ftyp, box('moov', mvhd, trak, box('mvex', trex))]);
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** @param {{ seq: number, decodeTimeUs: number, durationUs: number, key: boolean, nalus: Uint8Array[] }} o */
export function mediaSegment({ seq, decodeTimeUs, durationUs, key, nalus }) {
  const kept = nalus.filter((n) => {
    const type = n[0] & 0x1f;
    return type !== NAL_AUD && type !== NAL_SPS && type !== NAL_PPS;
  });
  const payload = concat(
    kept.map((n) => {
      const out = new Uint8Array(4 + n.length);
      new DataView(out.buffer).setUint32(0, n.length);
      out.set(n, 4);
      return out;
    }),
  );
  /** @param {number} dataOffset */
  const moof = (dataOffset) =>
    box(
      'moof',
      fullBox(
        'mfhd',
        0,
        0,
        bytes(4, (v) => v.setUint32(0, seq)),
      ),
      box(
        'traf',
        fullBox(
          'tfhd',
          0,
          0x020000,
          bytes(4, (v) => v.setUint32(0, 1)),
        ),
        fullBox(
          'tfdt',
          1,
          0,
          bytes(8, (v) => v.setBigUint64(0, BigInt(decodeTimeUs))),
        ),
        fullBox(
          'trun',
          0,
          0x000701,
          bytes(20, (v) => {
            v.setUint32(0, 1);
            v.setInt32(4, dataOffset);
            v.setUint32(8, durationUs);
            v.setUint32(12, payload.length);
            v.setUint32(16, key ? 0x02000000 : 0x01010000);
          }),
        ),
      ),
    );
  const head = moof(0);
  return concat([moof(head.length + 8), box('mdat', payload)]);
}
