# Project handoff: p2p-video-chat

## What this is
A minimal Zoom-like service: password-protected rooms for peer-to-peer
video/audio chat over WebRTC. No database, no user accounts — room state
lives in server memory, and access is gated by a single shared room
password. Built as a prototype, now functional end to end locally.

## Architecture
- **Topology**: WebRTC mesh (every peer connects directly to every
  other). Suits ~2–4 people; would need an SFU for larger rooms.
- **Server role**: lightweight signaling relay only. Passes
  offer/answer/ICE between browsers over WebSockets and issues
  short-lived TURN credentials. Media never flows through the server
  (it's P2P, or via TURN relay when direct fails).
- **Stack**: Node.js (ES modules), Express for static files + a couple
  of routes, `ws` for WebSocket signaling. Vanilla JS frontend, no
  framework.
- **No persistence**: rooms are created on first join and deleted when
  empty. Server restart drops all rooms. Single server process only
  (no shared state / Redis yet).

## File layout
```
server/
  index.js        HTTP + WebSocket signaling server, in-memory rooms, join/signal/rename/leave handling
  rooms.js        Room password check: scrypt hash + constant-time compare, password from ROOM_PASSWORD env
  rateLimit.js    Per-IP join rate limiting (rolling failure window + lockout)
  turn.js         Short-lived coturn REST/HMAC TURN credential generation; getIceServers()
public/
  index.html      Green room + in-room grid markup
  css/style.css   All styles (dark theme, green room, tile grid, avatar placeholder, status badges)
  js/
    greenroom.js  Device acquisition, preview, device selection, join flow, wires signaling+mesh+room
    signaling.js  Thin EventTarget wrapper over the WebSocket protocol
    rtc.js        Mesh class: one RTCPeerConnection per peer, perfect-negotiation glare handling, fetches ICE from /ice
    room.js       In-room UI: tiles, avatar placeholders, connection-status badges, mic/cam toggles, clean leave
deploy/
  DEPLOY.md                        Full production guide (Caddy + coturn + VPS)
  Caddyfile.example                Reverse proxy + auto TLS template
  turnserver.conf.example          coturn config template (blank secret, placeholder IP)
  p2p-video-chat.service.example   systemd unit template
README.md         Front door: overview, local quick start, config table, security notes
.env.example      Config template
.env              Local secrets (gitignored) — ROOM_PASSWORD etc.
LICENSE           MIT
```

## Configuration (env vars, via `.env` loaded with `node --env-file`)
| Variable | Purpose |
|----------|---------|
| `ROOM_PASSWORD` | Shared password to join any room |
| `PORT` | Server port (default 3000) |
| `TURN_HOST` | TURN hostname; blank = STUN-only (local dev) |
| `TURN_SECRET` | Must match coturn `static-auth-secret` |
| `TURN_TTL_SECONDS` | TURN credential lifetime (default 3600) |

Requires Node.js 20.6+ (`--env-file`).

## Quick start (local)
```bash
npm install
cp .env.example .env   # set ROOM_PASSWORD, leave TURN_* blank for local
npm start
# open two tabs at http://localhost:3000, join the same room
# To test on other devices, expose it over HTTPS with a Cloudflare quick
# tunnel: cloudflared tunnel --url http://localhost:3000
# (see README "Testing on other devices"). Same-wifi calls work on STUN;
# cross-network needs TURN.
```

## What's done and working
- Green room: camera preview, device selection, mic/cam toggles,
  graceful fallback when camera is busy (audio-only) or devices are
  missing.
- Signaling: join with password check, rate limiting, peer
  join/leave/rename broadcasts, offer/answer/ICE relay.
- WebRTC mesh: peers see and hear each other; perfect-negotiation avoids
  offer glare.
- In-room UI: video grid, self tile (mirrored, locally muted), avatar
  placeholder when camera off, per-peer connection-status badges.
- Leave/rejoin without page reload; signaling recreated per join to
  avoid stacked listeners.
- TURN: server-issued short-lived credentials via `/ice`; STUN-only when
  TURN unconfigured.
- Docs: README, DEPLOY.md, sanitized deploy templates.

**Verified locally**: two tabs, same room, connect and exchange
audio/video. Self-echo across two local tabs is expected (both ends are
the same person) and is fine — real calls with two people work as
intended.

## Not yet done / known limitations
- **TURN untested** — needs the deployed VPS + coturn and ideally two
  devices on different networks. Local testing only exercises STUN.
- **`/ice` endpoint is public** — anyone hitting the domain can fetch a
  TURN credential and use relay bandwidth. Mitigation options: cap
  coturn `max-bps`, or move credential issuance to post-join over the
  WebSocket.
- **No reconnection logic** on transient network drops (badge shows
  "reconnecting…" but nothing actively re-establishes).
- **Mesh only** — scales to ~4 people before upload bandwidth degrades.
  No SFU.
- **Single server process** — no horizontal scaling; rooms are lost on
  restart.
- **Not deployed yet** — DEPLOY.md written but the actual
  VPS/Caddy/coturn setup hasn't been run.
- **No text chat, no screen sharing.**

## Security posture
- Room password hashed in memory (scrypt) + constant-time compare, never
  stored plaintext.
- Per-IP join rate limiting against brute force.
- WebRTC media encrypted in transit (DTLS-SRTP) by default.
- Signaling is plain `ws://` locally; **must** be `wss://` (TLS) off
  localhost or the password crosses the wire in cleartext — handled by
  Caddy in the deploy guide.
- Secrets (`.env`, real `turnserver.conf`, certs) kept out of git.

## Suggested next steps (unprioritized)
1. Actually deploy to a VPS following DEPLOY.md and verify TURN with a
   real cross-network call.
2. Harden `/ice` (post-join credential issuance or bandwidth caps).
3. Add reconnection handling for transient drops.
4. Text chat and/or screen sharing.
5. If rooms need >4 people, plan an SFU migration.

## Working notes / conventions
- No comments in code unless the logic earns it.
- When sending updated files, send them in full (past edits hit
  duplicate-declaration issues from partial splices).
- Each step has been committed with a detailed feature-list commit
  message.
