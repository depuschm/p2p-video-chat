import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// One shared room password for the prototype, from the environment.
// Falls back to a random one (printed at startup) so the server never
// runs with a blank or hardcoded password.
const RAW_PASSWORD = process.env.ROOM_PASSWORD ?? randomBytes(6).toString("hex");

if (!process.env.ROOM_PASSWORD) {
  console.warn(
    `\n[!] ROOM_PASSWORD not set. Using a random password for this run:\n    ${RAW_PASSWORD}\n    Set ROOM_PASSWORD in the environment for a stable password.\n`
  );
}

const SALT = randomBytes(16);
const KEY_LEN = 64;
const PASSWORD_HASH = scryptSync(RAW_PASSWORD, SALT, KEY_LEN);

export function checkRoomPassword(_room, candidate) {
  let candidateHash;
  try {
    candidateHash = scryptSync(String(candidate), SALT, KEY_LEN);
  } catch {
    return { ok: false };
  }

  // Constant-time compare avoids leaking correctness via timing.
  const ok =
    candidateHash.length === PASSWORD_HASH.length &&
    timingSafeEqual(candidateHash, PASSWORD_HASH);

  return { ok };
}
