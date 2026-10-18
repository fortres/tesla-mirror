// Usage: node tools/tap.mjs <x> <y> [host:port]   (x, y in 0..1)
const [x, y, hostPort = 'localhost:8080'] = process.argv.slice(2);
/** @param {string | undefined} v */
const valid = (v) =>
  v !== undefined && v.trim() !== '' && Number.isFinite(+v) && +v >= 0 && +v <= 1;
if (!valid(x) || !valid(y)) {
  console.error('usage: node tools/tap.mjs <x> <y> [host:port]   (x, y in 0..1)');
  process.exit(2);
}

const fail = () => {
  console.error(`cannot connect to ws://${hostPort}/ws`);
  process.exit(1);
};
const connectTimer = setTimeout(fail, 5000);
let released = false;
const ws = new WebSocket(`ws://${hostPort}/ws`);
ws.onerror = fail;
ws.onopen = () => {
  clearTimeout(connectTimer);
  ws.onerror = () => {
    console.error('connection error');
    process.exit(1);
  };
  ws.send(JSON.stringify({ t: 'touch', pts: [{ id: 0, x: +x, y: +y }] }));
  setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: 'touch', pts: [] }));
    released = true;
    setTimeout(() => ws.close(), 50);
  }, 60);
};
ws.onclose = () => {
  if (!released) {
    console.error('connection closed before the release was sent');
    process.exit(1);
  }
  process.exit(0);
};
