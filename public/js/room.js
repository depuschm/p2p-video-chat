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
    this.roomStatus = document.getElementById("roomStatus");
    this.micBtn = document.getElementById("roomMic");
    this.camBtn = document.getElementById("roomCam");
    this.shareBtn = document.getElementById("roomShare");
    this.leaveBtn = document.getElementById("leaveBtn");
    this.chatLog = document.getElementById("chatLog");
    this.chatForm = document.getElementById("chatForm");
    this.chatInput = document.getElementById("chatInput");

    this.names = new Map();
    this.micEnabled = false;
    this.camEnabled = false;
    this.sharing = false;
    this.screenStream = null;
  }

  enter(initialMic, initialCam) {
    this.micEnabled = initialMic;
    this.camEnabled = initialCam;

    this.greenRoomEl.classList.add("hidden");
    this.roomEl.classList.remove("hidden");
    this.roomTitle.textContent = `Room: ${this.roomName}`;
    this.setConnectionStatus("");

    this.#renderSelfTile();
    this.#syncControlLabels();

    if (this.shareBtn) {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        this.shareBtn.disabled = true;
        this.shareBtn.dataset.unsupported = "1";
      }
      this.#syncShareLabel();
    }

    this.mesh.addEventListener("peer-added", (e) =>
      this.#ensureTile(e.detail.peerId, e.detail.name)
    );
    this.mesh.addEventListener("stream", (e) =>
      this.#attachStream(e.detail.peerId, e.detail.stream)
    );
    this.mesh.addEventListener("peer-removed", (e) =>
      this.#removeTile(e.detail.peerId)
    );
    this.mesh.addEventListener("peer-state", (e) =>
      this.#onPeerState(e.detail.peerId, e.detail.state)
    );

    this.signaling.addEventListener("peer-renamed", (e) => {
      this.names.set(e.detail.peerId, e.detail.name);
      const tile = this.grid.querySelector(`#tile-${e.detail.peerId}`);
      if (tile) {
        tile.querySelector(".label").textContent = e.detail.name;
        tile.querySelector(".avatar").textContent = this.#initial(e.detail.name);
      }
    });

    this.signaling.addEventListener("chat", (e) => this.#appendChat(e.detail));

    this.micBtn.onclick = () => {
      this.micEnabled = !this.micEnabled;
      this.mesh.setTrackEnabled("audio", this.micEnabled);
      this.#syncControlLabels();
    };

    this.camBtn.onclick = () => {
      this.camEnabled = !this.camEnabled;
      this.mesh.setTrackEnabled("video", this.camEnabled);
      this.#setPlaceholder("self", !this.camEnabled);
      this.#syncControlLabels();
    };

    if (this.shareBtn) this.shareBtn.onclick = () => this.#toggleShare();

    if (this.chatForm) {
      this.chatForm.onsubmit = (e) => {
        e.preventDefault();
        const text = this.chatInput.value.trim();
        if (!text) return;
        this.signaling.sendChat(text);
        this.chatInput.value = "";
      };
    }

    this.leaveBtn.onclick = () => this.#leave();
  }

  // Show/clear a transient status line in the room bar (e.g. reconnecting).
  setConnectionStatus(text) {
    if (!this.roomStatus) return;
    this.roomStatus.textContent = text;
    this.roomStatus.classList.toggle("hidden", !text);
  }

  // Remove every remote tile but keep the self tile. Used when a signaling
  // reconnect resets the mesh and peers will be re-added fresh.
  clearRemoteTiles() {
    this.grid.querySelectorAll(".tile:not(.self)").forEach((t) => t.remove());
    this.names.clear();
  }

  // Exit without sending a leave message — the socket is already gone
  // (used after reconnection has been given up on).
  forceLeave() {
    this.#teardown();
  }

  #leave() {
    this.signaling.leave();
    this.#teardown();
  }

  #teardown() {
    this.mesh.close();

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.sharing = false;

    this.grid.innerHTML = "";
    if (this.chatLog) this.chatLog.innerHTML = "";
    this.names.clear();
    this.setConnectionStatus("");
    this.roomEl.classList.add("hidden");
    this.greenRoomEl.classList.remove("hidden");

    this.onLeave();
  }

  async #toggleShare() {
    if (this.sharing) return this.#stopShare();

    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return;
    }

    const track = display.getVideoTracks()[0];
    if (!track) {
      display.getTracks().forEach((t) => t.stop());
      return;
    }

    this.screenStream = display;
    this.sharing = true;

    await this.mesh.setVideoTrack(track);
    this.#showSelfVideo(display, false);
    this.#setPlaceholder("self", false);

    track.onended = () => this.#stopShare();

    this.#syncShareLabel();
    this.#syncControlLabels();
  }

  async #stopShare() {
    if (!this.sharing) return;
    this.sharing = false;

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    const camTrack = this.localStream?.getVideoTracks()[0] ?? null;
    await this.mesh.setVideoTrack(camTrack);

    this.#showSelfVideo(this.localStream, true);
    this.#setPlaceholder("self", !camTrack || !this.camEnabled);

    this.#syncShareLabel();
    this.#syncControlLabels();
  }

  #showSelfVideo(stream, mirror) {
    const tile = this.grid.querySelector("#tile-self");
    if (!tile) return;
    tile.querySelector("video").srcObject = stream;
    tile.classList.toggle("no-mirror", !mirror);
  }

  #syncShareLabel() {
    if (!this.shareBtn) return;
    if (this.shareBtn.dataset.unsupported) {
      this.shareBtn.textContent = "Share n/a";
      return;
    }
    this.shareBtn.textContent = this.sharing ? "Stop sharing" : "Share screen";
    this.shareBtn.setAttribute("aria-pressed", String(this.sharing));
  }

  #syncControlLabels() {
    const hasMic = (this.localStream?.getAudioTracks().length ?? 0) > 0;
    const hasCam = (this.localStream?.getVideoTracks().length ?? 0) > 0;

    this.micBtn.disabled = !hasMic;
    this.camBtn.disabled = !hasCam || this.sharing;
    this.micBtn.setAttribute("aria-pressed", String(this.micEnabled && hasMic));
    this.camBtn.setAttribute("aria-pressed", String(this.camEnabled && hasCam));
    this.micBtn.textContent = !hasMic ? "No mic" : this.micEnabled ? "Mic on" : "Mic off";
    this.camBtn.textContent = !hasCam ? "No camera" : this.camEnabled ? "Camera on" : "Camera off";
  }

  #renderSelfTile() {
    const hasCam = (this.localStream?.getVideoTracks().length ?? 0) > 0;
    const tile = this.#makeTile("self", `${this.selfName} (you)`, this.selfName);
    tile.classList.add("self");
    const video = tile.querySelector("video");
    video.muted = true; // never play your own audio back
    video.srcObject = this.localStream;
    // Show avatar when there's no camera or it's toggled off.
    this.#setPlaceholder("self", !hasCam || !this.camEnabled);
    // Self tile has no connection status.
    tile.querySelector(".badge").classList.add("hidden");
  }

  #ensureTile(peerId, name) {
    if (name) this.names.set(peerId, name);
    if (this.grid.querySelector(`#tile-${peerId}`)) return;
    const displayName = this.names.get(peerId) || "Connecting…";
    this.#makeTile(peerId, displayName, this.names.get(peerId) || "?");
  }

  #attachStream(peerId, stream) {
    this.#ensureTile(peerId);
    const tile = this.grid.querySelector(`#tile-${peerId}`);
    if (!tile) return;

    const video = tile.querySelector("video");
    video.srcObject = stream;

    const [vtrack] = stream.getVideoTracks();
    if (!vtrack) {
      // Peer has no camera at all — keep the avatar up.
      this.#setPlaceholder(peerId, true);
      return;
    }
    // A remote track reports "muted" when the sender disables it.
    this.#setPlaceholder(peerId, vtrack.muted);
    vtrack.onmute = () => this.#setPlaceholder(peerId, true);
    vtrack.onunmute = () => this.#setPlaceholder(peerId, false);
  }

  #removeTile(peerId) {
    this.grid.querySelector(`#tile-${peerId}`)?.remove();
    this.names.delete(peerId);
  }

  #onPeerState(peerId, state) {
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
              ? "reconnecting…"
              : "";

    badge.textContent = text;
    badge.classList.toggle("hidden", text === "");
    badge.classList.toggle("error", false);
  }

  #setPlaceholder(id, show) {
    const ph = this.grid.querySelector(`#tile-${id} .placeholder`);
    if (ph) ph.classList.toggle("hidden", !show);
  }

  #appendChat({ peerId, name, text, ts }) {
    if (!this.chatLog) return;
    const mine = peerId === this.mesh.selfId;

    const row = document.createElement("div");
    row.className = mine ? "chat-msg self" : "chat-msg";

    const meta = document.createElement("span");
    meta.className = "chat-meta";
    const who = mine ? "You" : name || "Guest";
    const time = new Date(ts ?? Date.now()).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    meta.textContent = `${who} · ${time}`;

    const body = document.createElement("div");
    body.className = "chat-text";
    body.textContent = text;

    row.append(meta, body);
    this.chatLog.append(row);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  #initial(name) {
    return (name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  #makeTile(id, labelText, avatarName) {
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
    avatar.textContent = this.#initial(avatarName);
    placeholder.append(avatar);

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = labelText;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "connecting…";

    const fsBtn = document.createElement("button");
    fsBtn.className = "fullscreen-btn";
    fsBtn.type = "button";
    fsBtn.setAttribute("aria-label", "Fullscreen");
    fsBtn.textContent = "⛶";
    fsBtn.onclick = () => {
      if (document.fullscreenElement === tile) {
        document.exitFullscreen();
      } else {
        tile.requestFullscreen().catch(() => { });
      }
    };

    tile.append(video, placeholder, label, badge, fsBtn);
    this.grid.append(tile);
    return tile;
  }
}
