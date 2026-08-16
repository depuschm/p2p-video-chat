// Fetch ICE servers (STUN + short-lived TURN) from our server once,
// and reuse for all peer connections in this session.
let iceServersPromise = null;

// How long to let a "disconnected" connection try to recover on its own
// before forcing an ICE restart. "failed" restarts immediately.
const DISCONNECT_GRACE_MS = 2000;

function getIceServers() {
  if (!iceServersPromise) {
    iceServersPromise = fetch("/ice")
      .then((r) => r.json())
      .then((d) => d.iceServers)
      .catch((err) => {
        console.error("Failed to fetch ICE config, falling back to STUN:", err);
        return [{ urls: "stun:stun.l.google.com:19302" }];
      });
  }
  return iceServersPromise;
}

// Manages a mesh of peer connections, one per remote peer, using the
// perfect-negotiation pattern to avoid offer glare.
export class Mesh extends EventTarget {
  constructor({ signaling, localStream, selfId }) {
    super();
    this.signaling = signaling;
    this.localStream = localStream;
    this.selfId = selfId;
    this.peers = new Map(); // peerId -> { pc, polite, makingOffer, ignoreOffer, disconnectTimer }
    this.iceServers = null;

    this.signaling.addEventListener("signal", (e) => this.#onSignal(e.detail));
  }

  async #ensureIceServers() {
    if (!this.iceServers) this.iceServers = await getIceServers();
    return this.iceServers;
  }

  async addPeer(peerId, name) {
    if (this.peers.has(peerId)) return;

    const iceServers = await this.#ensureIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    // Deterministic role: lexicographically smaller id is "polite".
    const polite = this.selfId < peerId;
    const state = {
      pc,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      disconnectTimer: null,
    };
    this.peers.set(peerId, state);

    this.dispatchEvent(new CustomEvent("peer-added", { detail: { peerId, name } }));

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    } else {
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.addTransceiver("video", { direction: "recvonly" });
    }

    pc.ontrack = (ev) => {
      this.dispatchEvent(
        new CustomEvent("stream", { detail: { peerId, stream: ev.streams[0] } })
      );
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signaling.signal(peerId, { candidate });
    };

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        this.signaling.signal(peerId, { description: pc.localDescription });
      } catch (err) {
        console.error("negotiation error", err);
      } finally {
        state.makingOffer = false;
      }
    };

    // Report every connection-state change so the UI can show status, and
    // actively recover a dropped path via ICE restart.
    pc.onconnectionstatechange = () => {
      const cs = pc.connectionState;
      this.dispatchEvent(
        new CustomEvent("peer-state", { detail: { peerId, state: cs } })
      );

      if (cs === "failed") {
        this.#restartIce(peerId);
      } else if (cs === "disconnected") {
        // A disconnect often heals itself (NAT rebinding, brief loss).
        // Wait a beat before forcing a restart to avoid churn.
        clearTimeout(state.disconnectTimer);
        state.disconnectTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected") this.#restartIce(peerId);
        }, DISCONNECT_GRACE_MS);
      } else if (cs === "connected") {
        clearTimeout(state.disconnectTimer);
        state.disconnectTimer = null;
      }
    };

    return state;
  }

  // Trigger an ICE restart. restartIce() flags fresh ICE credentials and
  // fires onnegotiationneeded, which sends a new offer. Only the impolite
  // peer drives it so both sides don't restart at once.
  #restartIce(peerId) {
    const state = this.peers.get(peerId);
    if (!state || state.polite) return;
    try {
      state.pc.restartIce();
    } catch (err) {
      console.error("ICE restart failed", err);
    }
  }

  removePeer(peerId) {
    const state = this.peers.get(peerId);
    if (!state) return;
    clearTimeout(state.disconnectTimer);
    state.pc.close();
    this.peers.delete(peerId);
    this.dispatchEvent(new CustomEvent("peer-removed", { detail: { peerId } }));
  }

  // Apply the current mic/cam enabled flags to all outgoing tracks.
  setTrackEnabled(kind, enabled) {
    if (!this.localStream) return;
    const tracks =
      kind === "audio"
        ? this.localStream.getAudioTracks()
        : this.localStream.getVideoTracks();
    tracks.forEach((t) => (t.enabled = enabled));
  }

  // After a signaling reconnect the server issues a new self id and the
  // old peer connections are stale. Drop them all and adopt the new id;
  // the caller then re-adds the current peers.
  reset(newSelfId) {
    this.close();
    this.selfId = newSelfId;
  }

  close() {
    for (const [, state] of this.peers) {
      clearTimeout(state.disconnectTimer);
      state.pc.close();
    }
    this.peers.clear();
  }

  async #onSignal({ from, data }) {
    let state = this.peers.get(from);
    // A signal can arrive before we've registered the peer (race on join).
    if (!state) state = await this.addPeer(from, "");

    const { pc, polite } = state;

    try {
      if (data.description) {
        const offerCollision =
          data.description.type === "offer" &&
          (state.makingOffer || pc.signalingState !== "stable");

        state.ignoreOffer = !polite && offerCollision;
        if (state.ignoreOffer) return;

        await pc.setRemoteDescription(data.description);
        if (data.description.type === "offer") {
          await pc.setLocalDescription();
          this.signaling.signal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!state.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error("signal handling error", err);
    }
  }
}
