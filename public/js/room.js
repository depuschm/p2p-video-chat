export class Room {
  constructor({ mesh, signaling, localStream, selfName, roomName, onLeave }) {
    this.mesh = mesh;
    this.signaling = signaling;
    this.localStream = localStream;
    this.selfName = selfName;
    this.roomName = roomName;
    this.onLeave = onLeave ?? (() => { });

    this.grid = document.getElementById("grid");
    this.roomEl = document.getElementById("room");
    this.greenRoomEl = document.getElementById("greenRoom");
    this.roomTitle = document.getElementById("roomTitle");
    this.micBtn = document.getElementById("roomMic");
    this.camBtn = document.getElementById("roomCam");
    this.leaveBtn = document.getElementById("leaveBtn");

    this.names = new Map(); // peerId -> name
    this.micEnabled = false;
    this.camEnabled = false;
  }

  enter(initialMic, initialCam) {
    this.micEnabled = initialMic;
    this.camEnabled = initialCam;

    this.greenRoomEl.classList.add("hidden");
    this.roomEl.classList.remove("hidden");
    this.roomTitle.textContent = `Room: ${this.roomName}`;

    this._renderSelfTile();
    this._syncControlLabels();

    this.mesh.addEventListener("peer-added", (e) =>
      this._ensureTile(e.detail.peerId, e.detail.name)
    );
    this.mesh.addEventListener("stream", (e) =>
      this._attachStream(e.detail.peerId, e.detail.stream)
    );
    this.mesh.addEventListener("peer-removed", (e) =>
      this._removeTile(e.detail.peerId)
    );
    this.mesh.addEventListener("peer-state", (e) =>
      this._onPeerState(e.detail.peerId, e.detail.state)
    );

    this.signaling.addEventListener("peer-renamed", (e) => {
      this.names.set(e.detail.peerId, e.detail.name);
      const tile = this.grid.querySelector(`#tile-${e.detail.peerId}`);
      if (tile) {
        tile.querySelector(".label").textContent = e.detail.name;
        tile.querySelector(".avatar").textContent = this._initial(e.detail.name);
      }
    });

    // .onclick (not addEventListener) so repeat joins don't stack handlers.
    this.micBtn.onclick = () => {
      this.micEnabled = !this.micEnabled;
      this.mesh.setTrackEnabled("audio", this.micEnabled);
      this._syncControlLabels();
    };

    this.camBtn.onclick = () => {
      this.camEnabled = !this.camEnabled;
      this.mesh.setTrackEnabled("video", this.camEnabled);
      this._setPlaceholder("self", !this.camEnabled);
      this._syncControlLabels();
    };

    this.leaveBtn.onclick = () => this._leave();
  }

  _leave() {
    this.signaling.leave();
    this.mesh.close();

    this.grid.innerHTML = "";
    this.names.clear();
    this.roomEl.classList.add("hidden");
    this.greenRoomEl.classList.remove("hidden");

    this.onLeave();
  }

  _syncControlLabels() {
    const hasMic = (this.localStream?.getAudioTracks().length ?? 0) > 0;
    const hasCam = (this.localStream?.getVideoTracks().length ?? 0) > 0;

    this.micBtn.disabled = !hasMic;
    this.camBtn.disabled = !hasCam;
    this.micBtn.setAttribute("aria-pressed", String(this.micEnabled && hasMic));
    this.camBtn.setAttribute("aria-pressed", String(this.camEnabled && hasCam));
    this.micBtn.textContent = !hasMic ? "No mic" : this.micEnabled ? "Mic on" : "Mic off";
    this.camBtn.textContent = !hasCam ? "No camera" : this.camEnabled ? "Camera on" : "Camera off";
  }

  _renderSelfTile() {
    const hasCam = (this.localStream?.getVideoTracks().length ?? 0) > 0;
    const tile = this._makeTile("self", `${this.selfName} (you)`, this.selfName);
    tile.classList.add("self");
    const video = tile.querySelector("video");
    video.muted = true; // never play your own audio back
    video.srcObject = this.localStream;
    // Show avatar when there's no camera or it's toggled off.
    this._setPlaceholder("self", !hasCam || !this.camEnabled);
    // Self tile has no connection status.
    tile.querySelector(".badge").classList.add("hidden");
  }

  _ensureTile(peerId, name) {
    if (name) this.names.set(peerId, name);
    if (this.grid.querySelector(`#tile-${peerId}`)) return;
    const displayName = this.names.get(peerId) || "Connecting…";
    this._makeTile(peerId, displayName, this.names.get(peerId) || "?");
  }

  _attachStream(peerId, stream) {
    this._ensureTile(peerId);
    const tile = this.grid.querySelector(`#tile-${peerId}`);
    if (!tile) return;

    const video = tile.querySelector("video");
    video.srcObject = stream;

    const [vtrack] = stream.getVideoTracks();
    if (!vtrack) {
      // Peer has no camera at all — keep the avatar up.
      this._setPlaceholder(peerId, true);
      return;
    }
    // A remote track reports "muted" when the sender disables it.
    this._setPlaceholder(peerId, vtrack.muted);
    vtrack.onmute = () => this._setPlaceholder(peerId, true);
    vtrack.onunmute = () => this._setPlaceholder(peerId, false);
  }

  _removeTile(peerId) {
    this.grid.querySelector(`#tile-${peerId}`)?.remove();
    this.names.delete(peerId);
  }

  _onPeerState(peerId, state) {
    const badge = this.grid.querySelector(`#tile-${peerId} .badge`);
    if (!badge) return;

    const text =
      state === "connected"
        ? ""
        : state === "connecting" || state === "new"
          ? "connecting…"
          : state === "disconnected"
            ? "reconnecting…"
            : state === "failed"
              ? "connection failed"
              : "";

    badge.textContent = text;
    badge.classList.toggle("hidden", text === "");
    badge.classList.toggle("error", state === "failed");
  }

  _setPlaceholder(id, show) {
    const ph = this.grid.querySelector(`#tile-${id} .placeholder`);
    if (ph) ph.classList.toggle("hidden", !show);
  }

  _initial(name) {
    return (name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  _makeTile(id, labelText, avatarName) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.id = `tile-${id}`;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;

    const placeholder = document.createElement("div");
    placeholder.className = "placeholder hidden";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = this._initial(avatarName); // textContent avoids injection
    placeholder.append(avatar);

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = labelText;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "connecting…";

    tile.append(video, placeholder, label, badge);
    this.grid.append(tile);
    return tile;
  }
}
