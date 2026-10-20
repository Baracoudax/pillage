// Serveur multijoueur : sert le client compilé (dist/) et héberge les salons via WebSocket (/ws).
// Chaque salon fait tourner une instance World autoritaire à 20 Hz.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from '../shared/world.js';
import { DISTRICTS, TICK_RATE, MAX_PLAYERS_PER_ROOM } from '../shared/config.js';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.end('ok'); return; }
  let file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('Client non compilé : lancez "npm run build".'); return; }
  const ext = path.extname(file);
  const immutable = url.startsWith('/assets/') && /-[\w-]{8,}\./.test(url);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
});

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}

function createRoom(districtId, isPublic) {
  const code = newCode();
  const world = new World(districtId, { snapEvery: 2, pvp: true });
  const room = { code, world, clients: new Map(), nextId: 1, isPublic, created: Date.now() };
  let last = performance.now(), acc = 0;
  room.timer = setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= 1 / TICK_RATE) { world.step(1 / TICK_RATE); acc -= 1 / TICK_RATE; }
    if (world.ended && room.clients.size === 0) closeRoom(room);
  }, 1000 / TICK_RATE);
  rooms.set(code, room);
  console.log(`[salon ${code}] créé (${districtId})`);
  return room;
}

function closeRoom(room) {
  clearInterval(room.timer);
  rooms.delete(room.code);
  console.log(`[salon ${room.code}] fermé`);
}

function roomList() {
  return [...rooms.values()]
    .filter((r) => r.isPublic && !r.world.ended && r.world.duration - r.world.time > 90 && r.clients.size < MAX_PLAYERS_PER_ROOM)
    .map((r) => ({ code: r.code, district: r.world.d.id, players: r.clients.size, left: Math.round(r.world.duration - r.world.time) }));
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });

wss.on('connection', (ws) => {
  let room = null, pid = 0;
  const send = (m) => {
    if (ws.readyState !== 1) return;
    // si le client n'arrive plus à suivre, on saute des snapshots plutôt que d'accumuler du retard
    if (m.t === 'snap' && ws.bufferedAmount > 128 * 1024) return;
    ws.send(JSON.stringify(m));
  };
  const join = (r, msg) => {
    if (r.clients.size >= MAX_PLAYERS_PER_ROOM) return send({ t: 'error', msg: 'Salon plein.' });
    if (r.world.ended || r.world.duration - r.world.time < 60) return send({ t: 'error', msg: 'Ce raid est presque terminé.' });
    room = r;
    pid = r.nextId++;
    r.clients.set(pid, ws);
    send({ t: 'room', code: r.code });
    r.world.addPlayer(pid, msg.name, msg.loadout, send);
  };

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (room) { room.world.onMessage(pid, msg); return; }
    if (msg.t === 'list') send({ t: 'list', rooms: roomList() });
    else if (msg.t === 'create') join(createRoom(DISTRICTS[msg.district] ? msg.district : 'cite', msg.public !== false), msg);
    else if (msg.t === 'join') {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      if (!r) send({ t: 'error', msg: 'Salon introuvable.' });
      else join(r, msg);
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.world.removePlayer(pid);
    room.clients.delete(pid);
    if (room.clients.size === 0 && (room.world.ended || Date.now() - room.created > 1000)) closeRoom(room);
  });
});

server.listen(PORT, () => console.log(`Pillage : http://localhost:${PORT}  (WebSocket /ws)`));
