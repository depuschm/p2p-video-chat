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
// or both are missing. Returns a stream (possibly with only one kind of
// track) or null when the user has no usable devices at all.
async function acquireStream({ cameraId, micId } = {}) {
  const wantVideo = { video: cameraId ? { deviceId: { exact: cameraId } } : true };
  const wantAudio = { audio: micId ? { deviceId: { exact: micId } } : true };

  const attempts = [
    { ...wantVideo, ...wantAudio },
    { ...wantVideo, audio: false },
    { video: false, ...wantAudio },
  ];

  let lastErr = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // Denied permission or device busy won't be fixed by weaker
      // constraints — surface those immediately.
      if (err.name === "NotAllowedError" || err.name === "NotReadableError") {
        throw err;
      }
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

// Keep the UI honest about which devices actually exist.
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
    name: nameInput.value.trim(),
    room: roomInput.value.trim(),
    password: passwordInput.value,
    micEnabled,
    camEnabled,
    cameraId: cameraSelect.value || null,
    micId: micSelect.value || null,
    hasCamera,
    hasMic,
  };

  console.log("Joining with config:", { ...config, password: "***" });
  setStatus("Joining… (signaling not implemented yet — step 2)");
});

async function init() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("No media access — the page must be on https:// or localhost.");
    joinBtn.disabled = false;
    return;
  }

  // Report what the browser sees before requesting permission.
  try {
    const pre = await navigator.mediaDevices.enumerateDevices();
    const cams = pre.filter((d) => d.kind === "videoinput").length;
    const mics = pre.filter((d) => d.kind === "audioinput").length;
    console.log("Devices before permission:", pre);
    if (cams === 0 && mics === 0) {
      setStatus(
        "Browser sees no camera or mic. Check macOS Privacy settings for this browser, then reload. You can still join to watch/listen."
      );
      joinBtn.disabled = false;
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
    setStatus(
      err.name === "NotAllowedError"
        ? "Permission denied. Allow camera/mic (address-bar icon + macOS Privacy settings) and reload."
        : err.name === "NotReadableError"
          ? "Device is in use by another app. Close Zoom/Teams/etc. and reload."
          : `Media error: ${err.name || err.message}`
    );
    joinBtn.disabled = false;
    return;
  }

  try {
    await populateDevices();
  } catch (err) {
    console.error("populateDevices failed:", err);
  }

  setStatus(stream ? null : "No usable devices — you can still join to watch and listen.");
  joinBtn.disabled = false;
}

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  populateDevices().catch(() => { });
});

init();
