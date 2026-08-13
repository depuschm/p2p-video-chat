import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { checkRoomPassword } from "./rooms.js";
import { rateLimiter } from "./rateLimit.js";
import { getIceServers } from "./turn.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

const app = express();
app.use(express.static(join(__dirname, "..", "public")));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Hands short-lived ICE/TURN config to clients. No secrets leave the
// server — only a time-limited HMAC credential the browser can use.
app.get("/ice", (_req, res) => {
  res.json({ iceServers: getIceServers() });
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

// room name -> { members: Map<peerId, { ws, name }> }
const rooms = new Map();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  const r = rooms.get(room);
  if (!r) return;
  for (const [id, member] of r.members) {
    if (id !== exceptId) send(member.ws, msg);
  }
}

function leaveRoom(ws) {
  const { room, peerId } = ws.ctx ?? {};
  if (!room || !rooms.has(room)) return;

  const r = rooms.get(room);
  r.members.delete(peerId);
  broadcast(room, { type: "peer-left", peerId });

  if (r.members.size === 0) {
    rooms.delete(room); // no persistence — empty rooms disappear
  }
}

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  ws.ctx = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: "error", error: "bad-json" });
    }

    if (msg.type === "join") return handleJoin(ws, ip, msg);

    // All other messages require an established session.
    if (!ws.ctx) return send(ws, { type: "error", error: "not-joined" });

    switch (msg.type) {
      case "signal":
        return handleSignal(ws, msg);
      case "rename":
        return handleRename(ws, msg);
      case "leave":
        return ws.close(1000, "left");
      default:
        return send(ws, { type: "error", error: "unknown-type" });
    }
  });

  ws.on("close", () => leaveRoom(ws));
  ws.on("error", () => leaveRoom(ws));
});

function handleJoin(ws, ip, msg) {
  if (ws.ctx) return send(ws, { type: "error", error: "already-joined" });

  const room = String(msg.room ?? "").trim();
  const name = String(msg.name ?? "").trim().slice(0, 40) || "Guest";
  const password = String(msg.password ?? "");

  if (!room || !password) {
    return send(ws, { type: "error", error: "missing-fields" });
  }

  // Rate-limit join attempts per IP to blunt password brute-forcing.
  const rl = rateLimiter.check(ip);
  if (!rl.allowed) {
    return send(ws, { type: "error", error: "rate-limited", retryAfterMs: rl.retryAfterMs });
  }

  const result = checkRoomPassword(room, password);
  if (!result.ok) {
    rateLimiter.recordFailure(ip);
    return send(ws, { type: "error", error: "bad-password" });
  }
  rateLimiter.recordSuccess(ip);

  if (!rooms.has(room)) rooms.set(room, { members: new Map() });
  const r = rooms.get(room);

  const peerId = randomUUID();
  ws.ctx = { room, peerId, name };

  // Tell the newcomer who's already here (so it can initiate offers).
  const existing = [...r.members].map(([id, m]) => ({ peerId: id, name: m.name }));

  r.members.set(peerId, { ws, name });

  send(ws, { type: "joined", peerId, room, peers: existing });
  broadcast(room, { type: "peer-joined", peerId, name }, peerId);
}

function handleSignal(ws, msg) {
  const { room, peerId } = ws.ctx;
  const r = rooms.get(room);
  if (!r) return;

  const target = r.members.get(msg.to);
  if (!target) return send(ws, { type: "error", error: "no-such-peer" });

  // Relay the opaque WebRTC payload (offer/answer/ICE) to one peer.
  send(target.ws, { type: "signal", from: peerId, data: msg.data });
}

function handleRename(ws, msg) {
  const { room, peerId } = ws.ctx;
  const name = String(msg.name ?? "").trim().slice(0, 40) || "Guest";
  const r = rooms.get(room);
  if (!r) return;

  const member = r.members.get(peerId);
  if (member) member.name = name;
  ws.ctx.name = name;
  broadcast(room, { type: "peer-renamed", peerId, name });
}

server.listen(PORT, () => {
  console.log(`p2p-video-chat listening on http://localhost:${PORT}`);
});
