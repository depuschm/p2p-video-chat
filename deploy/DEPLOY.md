# Deployment guide

Running p2p-video-chat over the internet needs two things beyond the
local setup:

1. **HTTPS/WSS** — browsers only allow camera/mic access on secure
   origins, and it keeps the room password off the wire in cleartext.
2. **A TURN server** — a portion of connections (behind strict NATs and
   firewalls) can't establish a direct peer-to-peer path and need a
   relay. Without TURN, some calls silently fail to connect.

This guide uses Caddy (automatic Let's Encrypt TLS) as a reverse proxy
in front of the Node app, and coturn as a self-hosted TURN server on the
same VPS.

## Prerequisites

- A VPS with a public IP
- A domain you control
- Node.js 20.6+ on the VPS

## 1. DNS

Point A records at your VPS's public IP:

```
app.example.com   ->  <VPS_IP>
turn.example.com  ->  <VPS_IP>
```

## 2. Firewall ports

```
443/tcp            HTTPS + WSS (Caddy)
80/tcp             HTTP (Let's Encrypt + redirect)
3478/tcp,udp       TURN
5349/tcp           TURN over TLS
49152-65535/udp    TURN relay range
```

Open these in both the OS firewall and your cloud provider's security
group. The UDP relay range is required — TURN allocates relay ports
within it.

## 3. The app + Caddy

Copy the app to the server (e.g. `/opt/p2p-video-chat`), install deps,
and create `.env` with your real `ROOM_PASSWORD`, `TURN_HOST`
(`turn.example.com`), and `TURN_SECRET`.

Generate a strong TURN secret:

```bash
openssl rand -hex 32
```

Install Caddy, then use `deploy/Caddyfile.example` as your `Caddyfile`,
replacing `app.example.com`. Caddy obtains and renews the TLS cert
automatically and proxies to the Node app on localhost:3000. WebSocket
upgrades pass through with no extra config.

Run the app under systemd using
`deploy/p2p-video-chat.service.example` (adjust `WorkingDirectory` and
`User`):

```bash
sudo cp deploy/p2p-video-chat.service.example \
        /etc/systemd/system/p2p-video-chat.service
sudo systemctl daemon-reload
sudo systemctl enable --now p2p-video-chat
```

Verify: open `https://app.example.com`, allow camera access, confirm the
green room loads. That proves TLS/WSS works.

## 4. coturn

```bash
sudo apt update && sudo apt install coturn
```

Enable it by setting `TURNSERVER_ENABLED=1` in `/etc/default/coturn`.

Get a TLS cert for the TURN hostname:

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d turn.example.com
```

Use `deploy/turnserver.conf.example` as `/etc/turnserver.conf`. You MUST
set:

- `external-ip` to your real public IP (without it, relay candidates are
  wrong and TURN silently fails)
- `static-auth-secret` to the exact same value as `TURN_SECRET` in the
  app's `.env` (a mismatch rejects every credential the app issues)
- the cert paths to match your certbot output

```bash
sudo systemctl enable --now coturn
```

## 5. Verify TURN independently

Before a real call, confirm TURN issues relay candidates. Open the
WebRTC Trickle ICE sample:

https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Enter `turn:turn.example.com:3478` with a valid username/credential and
gather candidates. You should see `relay` candidates. If you only see
`host`/`srflx`, TURN isn't working — check `external-ip`, the secret
match, and the UDP port range.

## 6. Real call test

Test a two-device call across different networks (e.g. one on wifi, one
on mobile data). That's the true test that TURN relays when direct P2P
fails.

## Certificate renewal

certbot renews via its systemd timer, but coturn won't pick up a renewed
cert until restarted. Add a renewal hook or a periodic
`systemctl restart coturn`.

## Security notes

- coturn uses `use-auth-secret` so only clients with a valid short-lived
  HMAC credential can relay — this prevents it becoming an open relay.
  Keep `static-auth-secret` strong and out of git.
- The `/ice` endpoint is public in this prototype: anyone can fetch a
  TURN credential and use your relay bandwidth. For a private service,
  cap coturn bandwidth (`max-bps`) or move credential issuance to after
  a successful room join.
- Never commit the real `turnserver.conf`, `.env`, or any certs.
