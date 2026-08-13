export class Room {
  constructor({ mesh, signaling, localStream, selfName, roomName }) {
    this.mesh = mesh;
    this.signaling = signaling;
    this.localStream = localStream;
    this.selfName = selfName;
    this.roomName = roomName;

    this.grid = document.getElementById("grid");
    this.roomEl = document.getElementById("room");
    this.greenRoomEl = document.getElementById("greenRoom");
    this.roomTitle = document.getElementById("roomTitle");
    this.micBtn = document.getElementById("roomMic");
    this.camBtn = document.getElementById("roomCam");
    this.leaveBtn = document.getElementById("leaveBtn");

    this.names = new Map(); // peerId -> name
    this.micEnabled = localStream?.getAudioTracks().some((t) => t.enabled) ?? false;
    this.camEnabled = localStream?.getVideoTracks().some((t) => t.enabled) ?? false;
  }

  enter(initialMic, initialCam) {
    this.micEnabled = initialMic;
    this.camEnabled = initialCam;

    this.greenRoomEl.classList.add("hidden");
    this.roomEl.classList.remove("hidden");
    this.roomTitle.textContent = `Room: ${this.roomName}`;

    this.#renderSelfTile();
    this.#syncControlLabels();

    this.mesh.addEventListener("peer-added", (e) =>
      this.#ensureTile(e.detail.peerId, e.detail.name)
    );
    this.mesh.addEventListener("stream", (e) =>
      this.#attachStream(e.detail.peerId, e.detail.stream)
    );
    this.mesh.addEventListener("peer-removed", (e) =>
      this.#removeTile(e.detail.peerId)
    );

    this.signaling.addEventListener("peer-renamed", (e) => {
      this.names.set(e.detail.peerId, e.detail.name);
      const label = this.grid.querySelector(`#tile-${e.detail.peerId} .label`);
      if (label) label.textContent = e.detail.name;
    });

    this.micBtn.addEventListener("click", () => {
      this.micEnabled = !this.micEnabled;
      this.mesh.setTrackEnabled("audio", this.micEnabled);
      this.#syncControlLabels();
    });

    this.camBtn.addEventListener("click", () => {
      this.camEnabled = !this.camEnabled;
      this.mesh.setTrackEnabled("video", this.camEnabled);
      this.#syncControlLabels();
    });

    this.leaveBtn.addEventListener("click", () => {
      this.signaling.leave();
      this.mesh.close();
      location.reload(); // simplest reset back to the green room
    });
  }

  #syncControlLabels() {
    const hasMic = (this.localStream?.getAudioTracks().length ?? 0) > 0;
    const hasCam = (this.localStream?.getVideoTracks().length ?? 0) > 0;

    this.micBtn.disabled = !hasMic;
    this.camBtn.disabled = !hasCam;
    this.micBtn.setAttribute("aria-pressed", String(this.micEnabled && hasMic));
    this.camBtn.setAttribute("aria-pressed", String(this.camEnabled && hasCam));
    this.micBtn.textContent = !hasMic ? "No mic" : this.micEnabled ? "Mic on" : "Mic off";
    this.camBtn.textContent = !hasCam ? "No camera" : this.camEnabled ? "Camera on" : "Camera off";
  }

  #renderSelfTile() {
    const tile = this.#makeTile("self", `${this.selfName} (you)`);
    tile.classList.add("self");
    const video = tile.querySelector("video");
    video.muted = true; // never play your own audio back
    video.srcObject = this.localStream;
  }

  #ensureTile(peerId, name) {
    if (name) this.names.set(peerId, name);
    if (this.grid.querySelector(`#tile-${peerId}`)) return;
    this.#makeTile(peerId, this.names.get(peerId) || "Connecting…");
  }

  #attachStream(peerId, stream) {
    this.#ensureTile(peerId);
    const video = this.grid.querySelector(`#tile-${peerId} video`);
    if (video) video.srcObject = stream;
  }

  #removeTile(peerId) {
    this.grid.querySelector(`#tile-${peerId}`)?.remove();
  }

  #makeTile(id, labelText) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.id = `tile-${id}`;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = labelText; // textContent avoids HTML injection

    tile.append(video, label);
    this.grid.append(tile);
    return tile;
  }
}
