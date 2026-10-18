// Usage: node tools/tap.mjs <x> <y> [host:port]   (x, y in 0..1)
const [x, y, hostPort = 'localhost:8080'] = process.argv.slice(2);
if (x === undefined || y === undefined || Number.isNaN(+x) || Number.isNaN(+y)) {
  console.error('usage: node tools/tap.mjs <x> <y> [host:port]');
  process.exit(2);
}

const ws = new WebSocket(`ws://${hostPort}/ws`);
ws.onerror = () => {
  console.error(`cannot connect to ws://${hostPort}/ws`);
  process.exit(1);
};
ws.onopen = () => {
  ws.send(JSON.stringify({ t: 'touch', pts: [{ id: 0, x: +x, y: +y }] }));
  setTimeout(() => {
    ws.send(JSON.stringify({ t: 'touch', pts: [] }));
    setTimeout(() => ws.close(), 50);
  }, 60);
};
ws.onclose = () => process.exit(0);
