# p2p-video-chat

Minimal peer-to-peer video/audio chat over WebRTC — password-protected
rooms, no database, no accounts.

Participants connect directly to each other (WebRTC mesh); the server
only does signaling and issuing short-lived TURN credentials. Room state
lives in memory, so there's nothing to set up beyond a room password.

## Features

- Password-protected rooms (single shared password, no user accounts)
- Pre-join "green room": camera preview, device selection, mic/camera
  toggles, and a display name before you join
- Peer-to-peer audio/video via WebRTC mesh
- Live mic/camera toggles inside the room
- Works with audio only, or watch/listen-only when no devices are present
- No database — rooms exist in memory and disappear when empty

## How it works

The browsers do the heavy lifting. Audio and video flow directly between
peers using WebRTC. The Node server is a lightweight signaling relay: it
passes connection setup messages (offer/answer/ICE) between browsers and
issues short-lived TURN credentials. It never sees or stores your media.

Mesh topology suits small rooms (roughly 2–4 people). Larger rooms would
need an SFU, which is out of scope for this prototype.

## Quick start (local)

Requires Node.js 20.6 or newer.

```bash
git clone <your-repo-url>
cd p2p-video-chat
npm install

# Set a room password
cp .env.example .env
# edit .env and set ROOM_PASSWORD

npm start
```

Open http://localhost:3000, allow camera/microphone access, enter your
name, the room name, and the password, then Join. Open a second tab (or
another device on the same network) and join the same room to connect.

`localhost` counts as a secure origin, so camera access works without
HTTPS for local testing. Testing across machines or over the internet
requires HTTPS/WSS and TURN — see the deployment guide.

## Configuration

All configuration is via environment variables in a local `.env` file
(see `.env.example`):

| Variable          | Description                                          |
|-------------------|------------------------------------------------------|
| `ROOM_PASSWORD`   | Password required to join a room                     |
| `PORT`            | Server port (default 3000)                           |
| `TURN_HOST`       | TURN server hostname (leave blank for STUN-only dev) |
| `TURN_SECRET`     | Shared secret; must match coturn's static-auth-secret|
| `TURN_TTL_SECONDS`| Lifetime of issued TURN credentials (default 3600)   |

Never commit your real `.env` — it holds secrets and is gitignored.

## Deployment

To run this over the internet with a real domain, you need HTTPS/WSS and
a TURN server. See [deploy/DEPLOY.md](deploy/DEPLOY.md) for a full guide
covering Caddy (automatic TLS), coturn, DNS, and firewall setup.

## Security notes

- Access is gated only by the shared room password. Anyone with the room
  name and password can join. This suits a small private room, not a
  public multi-tenant service.
- WebRTC media is encrypted in transit (DTLS-SRTP) by default.
- The room password is hashed in memory (scrypt) and compared in
  constant time; it is never stored in plaintext.
- Join attempts are rate-limited per IP to blunt password guessing.
- Always run over HTTPS/WSS off localhost, or the password crosses the
  network in cleartext.

## Project structure

```
server/          Signaling server, room state, rate limiting, TURN creds
public/          Frontend (green room, in-room grid, WebRTC mesh logic)
deploy/          Sanitized deployment templates and guide
.env.example     Configuration template
```

## License

MIT — see [LICENSE](LICENSE).
