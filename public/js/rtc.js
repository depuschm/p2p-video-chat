// Public STUN for dev. TURN gets added at step 5 for cross-network use.
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// Manages a mesh of peer connections, one per remote peer, using the
// perfect-negotiation pattern to avoid offer glare.
export class Mesh extends EventTarget {
  constructor({ signaling, localStream, selfId }) {
    super();
    this.signaling = signaling;
    this.localStream = localStream;
    this.selfId = selfId;
    this.peers = new Map(); // peerId -> { pc, polite, makingOffer, ignoreOffer }

    this.signaling.addEventListener("signal", (e) => this.#onSignal(e.detail));
  }

  // Add a peer and, if we're the impolite side, start negotiation.
  addPeer(peerId, name) {
    if (this.peers.has(peerId)) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // Deterministic role: lexicographically larger id is "impolite"
    // (the one that pushes offers through on collision).
    const polite = this.selfId < peerId;
    const state = { pc, polite, makingOffer: false, ignoreOffer: false };
    this.peers.set(peerId, state);

    this.dispatchEvent(new CustomEvent("peer-added", { detail: { peerId, name } }));

    // Send whatever local tracks we have (may be none — receive-only).
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    } else {
      // No local media: still want to receive audio and video.
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.addTransceiver("video", { direction: "recvonly" });
    }

    pc.ontrack = (ev) => {
      this.dispatchEvent(
        new CustomEvent("stream", { detail: { peerId, stream: ev.streams[0] } })
      );
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.signaling.signal(peerId, { candidate });
      }
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

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        this.dispatchEvent(
          new CustomEvent("peer-state", {
            detail: { peerId, state: pc.connectionState },
          })
        );
      }
    };

    return state;
  }

  removePeer(peerId) {
    const state = this.peers.get(peerId);
    if (!state) return;
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

  close() {
    for (const [, state] of this.peers) state.pc.close();
    this.peers.clear();
  }

  async #onSignal({ from, data }) {
    let state = this.peers.get(from);
    // A signal can arrive before we've registered the peer (race on join).
    if (!state) state = this.addPeer(from, "");

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
