// Usage: node tools/fake-ios.mjs <annexb.h264> [port=8080] [--size 640x1280] [--sparse]
// Pretends to be the iPhone app: serves web/public/ and streams the file's H.264 access units.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ws is a devDependency of web/, not of tools/
const { WebSocketServer } = /** @type {typeof import('ws')} */ (
  createRequire(new URL('../web/package.json', import.meta.url))('ws')
);

const FRAME_MS = 1000 / 30;
const FRAME_US = 33_333;
const SPARSE_AFTER_MS = 3000;
const SPARSE_EVERY_MS = 2000;
const NAL_IDR = 5;
const NAL_AUD = 9;
const PUBLIC_DIR = resolve(fileURLToPath(new URL('../web/public/', import.meta.url)));
/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/**
 * @param {string[]} argv
 * @returns {{ file: string, port: number, w: number, h: number, sparse: boolean } | null}
 */
function parseArgs(argv) {
  const positional = [];
  let size = '640x1280';
  let sparse = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sparse') sparse = true;
    else if (argv[i] === '--size') size = argv[++i] ?? '';
    else positional.push(argv[i]);
  }
  const m = /^(\d+)x(\d+)$/.exec(size);
  const port = positional[1] === undefined ? 8080 : Number(positional[1]);
  if (!positional[0] || !m || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { file: positional[0], port, w: Number(m[1]), h: Number(m[2]), sparse };
}

/**
 * Splits an Annex B stream into access units at AUD NAL units.
 * @param {Buffer} data
 * @returns {{ key: boolean, data: Buffer }[]}
 */
function splitAccessUnits(data) {
  /** @type {{ at: number, type: number }[]} */
  const nals = [];
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      // include the leading zero of a 4-byte start code in the unit
      nals.push({ at: i > 0 && data[i - 1] === 0 ? i - 1 : i, type: data[i + 3] & 0x1f });
      i += 2;
    }
  }
  /** @type {{ key: boolean, data: Buffer }[]} */
  const units = [];
  let start = -1;
  let key = false;
  for (const nal of nals) {
    if (nal.type === NAL_AUD) {
      if (start >= 0) units.push({ key, data: data.subarray(start, nal.at) });
      start = nal.at;
      key = false;
    } else if (nal.type === NAL_IDR) key = true;
  }
  if (start >= 0) units.push({ key, data: data.subarray(start) });
  return units;
}

/**
 * @param {boolean} key
 * @param {number} ptsUs
 * @param {Buffer} au
 */
function frameMessage(key, ptsUs, au) {
  const header = Buffer.alloc(16);
  header.writeUInt8(1, 0);
  header.writeUInt8(key ? 1 : 0, 1);
  header.writeBigUInt64LE(BigInt(ptsUs), 4);
  return Buffer.concat([header, au]);
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.error(
    'usage: node tools/fake-ios.mjs <annexb.h264> [port=8080] [--size 640x1280] [--sparse]',
  );
  process.exit(2);
}
const units = splitAccessUnits(readFileSync(args.file));
if (!units.some((u) => u.key)) {
  console.error(
    `no keyframes found in ${args.file}; access units are split at AUD NAL units, encode with -x264-params aud=1`,
  );
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"capturing":true}');
    return;
  }
  const file = resolve(PUBLIC_DIR, '.' + (pathname === '/' ? '/index.html' : pathname));
  try {
    if (!file.startsWith(PUBLIC_DIR + sep)) throw new Error('outside public dir');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
/** @type {import('ws').WebSocket | null} */
let current = null;
/** @type {(() => void) | null} */
let stopCurrent = null;
const startedAt = Date.now();

wss.on('connection', (ws) => {
  if (stopCurrent) stopCurrent();
  if (current) current.terminate();
  current = ws;
  ws.send(
    JSON.stringify({
      t: 'state',
      capturing: true,
      accessibility: false,
      capture: { w: args.w, h: args.h },
      transport: 'h264ws',
      touch: false,
    }),
  );
  // start at the next keyframe in file order
  let next = Math.floor((Date.now() - startedAt) / FRAME_MS) % units.length;
  while (!units[next].key) next = (next + 1) % units.length;
  let ptsUs = 0;
  const sendNext = () => {
    const unit = units[next];
    next = (next + 1) % units.length;
    ptsUs += FRAME_US;
    if (ws.readyState === ws.OPEN) ws.send(frameMessage(unit.key, ptsUs, unit.data));
  };
  /** @type {ReturnType<typeof setInterval>} */
  let timer = setInterval(sendNext, FRAME_MS);
  /** @type {ReturnType<typeof setTimeout> | null} */
  let switchTimer = null;
  if (args.sparse)
    switchTimer = setTimeout(() => {
      clearInterval(timer);
      timer = setInterval(sendNext, SPARSE_EVERY_MS);
    }, SPARSE_AFTER_MS);
  const stop = () => {
    clearInterval(timer);
    if (switchTimer) clearTimeout(switchTimer);
    switchTimer = null;
  };
  stopCurrent = stop;
  ws.on('close', () => {
    stop();
    if (current === ws) {
      current = null;
      stopCurrent = null;
    }
  });
  ws.on('error', () => {});
});

server.listen(args.port, () => {
  console.log(
    `fake iOS on http://localhost:${args.port} (${units.length} units, ${args.w}x${args.h}${args.sparse ? ', sparse' : ''})`,
  );
});
