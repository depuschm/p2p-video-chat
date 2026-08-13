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

async function getStream({ cameraId, micId } = {}) {
  const constraints = {
    video: cameraId ? { deviceId: { exact: cameraId } } : true,
    audio: micId ? { deviceId: { exact: micId } } : true,
  };

  const next = await navigator.mediaDevices.getUserMedia(constraints);

  // Stop the old stream's tracks before swapping, so the hardware releases.
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }

  stream = next;
  applyToggleState();
  preview.srcObject = stream;
}

function applyToggleState() {
  if (!stream) return;
  stream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
  stream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
}

async function populateDevices() {
  // Labels are only available after permission has been granted.
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");

  fillSelect(cameraSelect, cameras, "Camera");
  fillSelect(micSelect, mics, "Microphone");
}

function fillSelect(select, devices, fallbackLabel) {
  const current = select.value;
  select.innerHTML = "";
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
  micEnabled = !micEnabled;
  toggleMicBtn.setAttribute("aria-pressed", String(micEnabled));
  toggleMicBtn.textContent = micEnabled ? "Mic on" : "Mic off";
  applyToggleState();
});

toggleCamBtn.addEventListener("click", () => {
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
  if (!stream) return;

  const config = {
    name: nameInput.value.trim(),
    room: roomInput.value.trim(),
    password: passwordInput.value,
    micEnabled,
    camEnabled,
    cameraId: cameraSelect.value,
    micId: micSelect.value,
  };

  // Step 2/3 will use this to open the WebSocket and start signaling.
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
    setStatus(null);
    joinBtn.disabled = false;
  } catch (err) {
    setStatus(
      err.name === "NotAllowedError"
        ? "Camera/microphone permission was denied. Enable it and reload."
        : `Could not access camera/microphone: ${err.message}`
    );
  }
}

// Re-enumerate if devices are plugged/unplugged.
navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  populateDevices().catch(() => { });
});

init();
