import { createHmac } from "node:crypto";

// coturn "REST API" style short-lived credentials.
// Node and coturn share TURN_SECRET; coturn validates the HMAC and expiry.
const TURN_SECRET = process.env.TURN_SECRET ?? "";
const TURN_HOST = process.env.TURN_HOST ?? ""; // e.g. turn.example.com
const TTL_SECONDS = Number(process.env.TURN_TTL_SECONDS ?? 3600);

export function turnConfigured() {
  return Boolean(TURN_SECRET && TURN_HOST);
}

// Returns an iceServers array the browser can pass to RTCPeerConnection.
// Always includes STUN; adds TURN (udp/tcp/tls) when configured.
export function getIceServers() {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

  if (!turnConfigured()) return iceServers;

  const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const username = `${expiry}`;
  const credential = createHmac("sha1", TURN_SECRET)
    .update(username)
    .digest("base64");

  iceServers.push({
    urls: [
      `turn:${TURN_HOST}:3478?transport=udp`,
      `turn:${TURN_HOST}:3478?transport=tcp`,
      `turns:${TURN_HOST}:5349?transport=tcp`,
    ],
    username,
    credential,
  });

  return iceServers;
}
