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
// or both are missing. Returns the stream (possibly with only one kind
// of track, or null if the user has no devices at all).
async function acquireStream({ cameraId, micId } = {}) {
  const wantVideo = { video: cameraId ? { deviceId: { exact: cameraId } } : true };
  const wantAudio = { audio: micId ? { deviceId: { exact: micId } } : true };

  // Attempt combinations from most to least capable.
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
      // NotAllowedError means permission was denied — no point trying
      // weaker constraints, the user has to grant access first.
      if (err.name === "NotAllowedError") throw err;
    }
  }
  // Every attempt failed (e.g. no camera and no mic at all).
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

// Disable controls for devices that aren't present, so the UI reflects
// reality instead of pretending a missing camera can be toggled.
function reflectDeviceAvailability() {
  toggleCamBtn.disabled = !hasCamera;
  toggleMicBtn.disabled = !hasMic;
  cameraSelect.disabled = !hasCamera;
  micSelect.disabled = !hasMic;

  if (!hasCamera) {
    camEnabled = false;
    toggleCamBtn.setAttribute("aria-pressed", "false");
    toggleCamBtn.textContent = "No camera";
  }
  if (!hasMic) {
    micEnabled = false;
    toggleMicBtn.setAttribute("aria-pressed", "false");
    toggleMicBtn.textContent = "No mic";
  }
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
  getStream({ cameraId: cameraSelect.value, micId: micSelect.value }).catch(
    (err) => setStatus(`Could not switch camera: ${err.message}`)
  )
);

micSelect.addEventListener("change", () =>
  getStream({ cameraId: cameraSelect.value, micId: micSelect.value }).catch(
    (err) => setStatus(`Could not switch microphone: ${err.message}`)
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
    setStatus("This browser does not support camera/microphone access.");
    return;
  }

  try {
    await getStream();
    await populateDevices();

    if (!stream) {
      setStatus("No camera or microphone found. You can still join to watch and listen.");
    } else {
      setStatus(null);
    }

    // Join is allowed regardless of devices — you can join to watch/listen only.
    joinBtn.disabled = false;
  } catch (err) {
    if (err.name === "NotAllowedError") {
      setStatus("Camera/microphone permission was denied. Enable it and reload.");
      // Even with permission denied, allow joining as a passive participant.
      joinBtn.disabled = false;
    } else {
      setStatus(`Could not access camera/microphone: ${err.message}`);
      joinBtn.disabled = false;
    }
  }
}

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  populateDevices().catch(() => { });
});

init();
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
// or both are missing. Returns the stream (possibly with only one kind
// of track, or null if the user has no devices at all).
async function acquireStream({ cameraId, micId } = {}) {
  const wantVideo = { video: cameraId ? { deviceId: { exact: cameraId } } : true };
  const wantAudio = { audio: micId ? { deviceId: { exact: micId } } : true };

  // Attempt combinations from most to least capable.
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
      // NotAllowedError means permission was denied — no point trying
      // weaker constraints, the user has to grant access first.
      if (err.name === "NotAllowedError") throw err;
    }
  }
  // Every attempt failed (e.g. no camera and no mic at all).
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

// Disable controls for devices that aren't present, so the UI reflects
// reality instead of pretending a missing camera can be toggled.
function reflectDeviceAvailability() {
  toggleCamBtn.disabled = !hasCamera;
  toggleMicBtn.disabled = !hasMic;
  cameraSelect.disabled = !hasCamera;
  micSelect.disabled = !hasMic;

  if (!hasCamera) {
    camEnabled = false;
    toggleCamBtn.setAttribute("aria-pressed", "false");
    toggleCamBtn.textContent = "No camera";
  }
  if (!hasMic) {
    micEnabled = false;
    toggleMicBtn.setAttribute("aria-pressed", "false");
    toggleMicBtn.textContent = "No mic";
  }
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
  getStream({ cameraId: cameraSelect.value, micId: micSelect.value }).catch(
    (err) => setStatus(`Could not switch camera: ${err.message}`)
  )
);

micSelect.addEventListener("change", () =>
  getStream({ cameraId: cameraSelect.value, micId: micSelect.value }).catch(
    (err) => setStatus(`Could not switch microphone: ${err.message}`)
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
    setStatus("This browser does not support camera/microphone access.");
    return;
  }

  try {
    await getStream();
    await populateDevices();

    if (!stream) {
      setStatus("No camera or microphone found. You can still join to watch and listen.");
    } else {
      setStatus(null);
    }

    // Join is allowed regardless of devices — you can join to watch/listen only.
    joinBtn.disabled = false;
  } catch (err) {
    if (err.name === "NotAllowedError") {
      setStatus("Camera/microphone permission was denied. Enable it and reload.");
      // Even with permission denied, allow joining as a passive participant.
      joinBtn.disabled = false;
    } else {
      setStatus(`Could not access camera/microphone: ${err.message}`);
      joinBtn.disabled = false;
    }
  }
}

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  populateDevices().catch(() => { });
});

init();
