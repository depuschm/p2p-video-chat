import { Signaling } from "./signaling.js";
import { Mesh } from "./rtc.js";
import { Room } from "./room.js";

const preview = document.getElementById("preview");
const previewStatus = document.getElementById("previewStatus");
const toggleMicBtn = document.getElementById("toggleMic");
const toggleCamBtn = document.getElementById("toggleCam");
const cameraSelect = document.getElementById("cameraSelect");
const micSelect = document.getElementById("micSelect");
const joinForm = document.getElementById("joinForm");
const joinBtn = document.getElementById("joinBtn");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const passwordInput = document.getElementById("passwordInput");

let stream = null;
let micEnabled = true;
let camEnabled = true;
let hasCamera = false;
let hasMic = false;

// Try to get the requested devices, falling back gracefully when one
// is missing, denied, or busy. A busy camera must not block audio, so
// NotReadableError does not abort the fallback chain — only a denied
// permission does. Returns a stream (possibly one kind of track) or
// null when nothing usable is available.
async function acquireStream({ cameraId, micId } = {}) {
  const wantVideo = { video: cameraId ? { deviceId: { exact: cameraId } } : true };
  const wantAudio = { audio: micId ? { deviceId: { exact: micId } } : true };

  const attempts = [
    { ...wantVideo, ...wantAudio }, // ideal: both
    { video: false, ...wantAudio }, // camera busy/denied → try audio only
    { ...wantVideo, audio: false }, // mic busy/denied → try video only
  ];

  let lastErr = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // Denied permission won't be fixed by weaker constraints — stop now.
      // NotReadableError (device busy) only affects that one device, so
      // keep trying the remaining combinations.
      if (err.name === "NotAllowedError") throw err;
    }
  }

  if (lastErr && lastErr.name !== "NotFoundError") throw lastErr;
  return null;
}

async function getStream(opts = {}) {
  const next = await acquireStream(opts);

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }

  stream = next;
  hasCamera = !!stream && stream.getVideoTracks().length > 0;
  hasMic = !!stream && stream.getAudioTracks().length > 0;

  applyToggleState();
  reflectDeviceAvailability();
  preview.srcObject = stream;
}

function applyToggleState() {
  if (!stream) return;
  stream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
  stream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
}

// Keep the UI honest about which devices actually exist. Only forces the
// enabled flag to false when the device is absent — never flips a present
// device off, so this is safe to call after acquisition without undoing
// the user's default-on intent.
function reflectDeviceAvailability() {
  toggleCamBtn.disabled = !hasCamera;
  toggleMicBtn.disabled = !hasMic;
  cameraSelect.disabled = !hasCamera;
  micSelect.disabled = !hasMic;

  camEnabled = hasCamera ? camEnabled : false;
  toggleCamBtn.setAttribute("aria-pressed", String(camEnabled));
  toggleCamBtn.textContent = !hasCamera ? "No camera" : camEnabled ? "Camera on" : "Camera off";

  micEnabled = hasMic ? micEnabled : false;
  toggleMicBtn.setAttribute("aria-pressed", String(micEnabled));
  toggleMicBtn.textContent = !hasMic ? "No mic" : micEnabled ? "Mic on" : "Mic off";
}

async function populateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");

  fillSelect(cameraSelect, cameras, "Camera", "No cameras found");
  fillSelect(micSelect, mics, "Microphone", "No microphones found");
}

function fillSelect(select, devices, fallbackLabel, emptyLabel) {
  const current = select.value;
  select.innerHTML = "";

  if (devices.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = emptyLabel;
    select.appendChild(opt);
    return;
  }

  devices.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `${fallbackLabel} ${i + 1}`;
    select.appendChild(opt);
  });
  if (current) select.value = current;
}

function setStatus(text) {
  if (text) {
    previewStatus.textContent = text;
    previewStatus.classList.remove("hidden");
  } else {
    previewStatus.classList.add("hidden");
  }
}

toggleMicBtn.addEventListener("click", () => {
  if (!hasMic) return;
  micEnabled = !micEnabled;
  toggleMicBtn.setAttribute("aria-pressed", String(micEnabled));
  toggleMicBtn.textContent = micEnabled ? "Mic on" : "Mic off";
  applyToggleState();
});

toggleCamBtn.addEventListener("click", () => {
  if (!hasCamera) return;
  camEnabled = !camEnabled;
  toggleCamBtn.setAttribute("aria-pressed", String(camEnabled));
  toggleCamBtn.textContent = camEnabled ? "Camera on" : "Camera off";
  applyToggleState();
});

cameraSelect.addEventListener("change", () =>
  getStream({ cameraId: cameraSelect.value, micId: micSelect.value }).catch((err) =>
    setStatus(`Could not switch camera: ${err.message}`)
  )
);

micSelect.addEventListener("change", () =>
  getStream({ cameraId: cameraSelect.value, micId: micSelect.value }).catch((err) =>
    setStatus(`Could not switch microphone: ${err.message}`)
  )
);

joinForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const config = {
    name: nameInput.value.trim() || "Guest",
    room: roomInput.value.trim(),
    password: passwordInput.value,
  };

  setStatus("Connecting…");
  joinBtn.disabled = true;

  // Fresh signaling per join so event listeners don't accumulate across
  // leave/rejoin cycles.
  const signaling = new Signaling();
  signaling.connect(config);

  signaling.addEventListener("joined", (ev) => {
    const { peerId: selfId, peers } = ev.detail;

    const mesh = new Mesh({ signaling, localStream: stream, selfId });
    const room = new Room({
      mesh,
      signaling,
      localStream: stream,
      selfName: config.name,
      roomName: config.room,
      onLeave: () => {
        joinBtn.disabled = false;
        setStatus(null);
      },
    });
    room.enter(micEnabled, camEnabled);

    // Connect to everyone already in the room. onnegotiationneeded on
    // the impolite side kicks off the offer automatically.
    for (const p of peers) {
      mesh.addPeer(p.peerId, p.name);
    }

    // New arrivals after us.
    signaling.addEventListener("peer-joined", (e2) => {
      mesh.addPeer(e2.detail.peerId, e2.detail.name);
    });
    signaling.addEventListener("peer-left", (e2) => {
      mesh.removePeer(e2.detail.peerId);
    });

    // Signaling socket dropped — show progress while it backs off.
    signaling.addEventListener("reconnecting", (e2) => {
      room.setConnectionStatus(`Reconnecting… (attempt ${e2.detail.attempt})`);
    });

    // Socket came back. The server issued a new self id and the old peer
    // connections are dead, so reset the mesh and re-add current peers.
    signaling.addEventListener("rejoined", (e2) => {
      mesh.reset(e2.detail.peerId);
      room.clearRemoteTiles();
      room.setConnectionStatus("");
      for (const p of e2.detail.peers) {
        mesh.addPeer(p.peerId, p.name);
      }
    });

    // Gave up reconnecting — return to the green room.
    signaling.addEventListener("reconnect-failed", () => {
      room.setConnectionStatus("Disconnected — couldn't reconnect.");
      room.forceLeave();
    });
  });

  signaling.addEventListener("error", (ev) => {
    const err = ev.detail.error;
    setStatus(
      err === "bad-password"
        ? "Wrong room password."
        : err === "rate-limited"
          ? `Too many attempts. Try again in ${Math.ceil(ev.detail.retryAfterMs / 1000)}s.`
          : `Join failed: ${err}`
    );
    joinBtn.disabled = false;
  });

  signaling.addEventListener("closed", () => {
    setStatus("Disconnected.");
    joinBtn.disabled = false;
  });
});

async function init() {
  // Media is best-effort — a watch/listen-only join is always valid, so
  // never gate Join on device acquisition. Enable it up front; nothing
  // in the media flow below should ever be able to lock the user out.
  joinBtn.disabled = false;

  if (!navigator.mediaDevices?.getUserMedia) {
    reflectDeviceAvailability();
    setStatus("This browser can't access a camera or mic — you can still join to watch and listen.");
    return;
  }

  try {
    const pre = await navigator.mediaDevices.enumerateDevices();
    const cams = pre.filter((d) => d.kind === "videoinput").length;
    const mics = pre.filter((d) => d.kind === "audioinput").length;
    if (cams === 0 && mics === 0) {
      reflectDeviceAvailability();
      setStatus("No camera or mic detected — you can still join to watch and listen.");
      return;
    }
    setStatus(`Detected ${cams} camera(s), ${mics} mic(s). Requesting access…`);
  } catch (err) {
    console.error("enumerateDevices failed:", err);
  }

  try {
    await getStream();
  } catch (err) {
    console.error("getStream failed:", err);
    reflectDeviceAvailability();
    setStatus(
      err.name === "NotAllowedError"
        ? "Permission denied. Allow camera/mic and reload, or join now to watch and listen."
        : err.name === "NotReadableError"
          ? "Camera and mic are in use by another app — join to watch and listen, or free them and reload."
          : `Media unavailable (${err.name || err.message}) — you can still join to watch and listen.`
    );
    return;
  }

  try {
    await populateDevices();
  } catch (err) {
    console.error("populateDevices failed:", err);
  }

  if (!stream) {
    setStatus("No usable devices — you can still join to watch and listen.");
  } else if (!hasCamera) {
    setStatus("Camera unavailable (in use or blocked) — joining with audio only. Free the camera and reload to enable video.");
  } else {
    setStatus(null);
  }
}

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  populateDevices().catch(() => { });
});

init();
