const MAX_RECONNECT_ATTEMPTS = 6;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

export class Signaling extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.peerId = null;
    this.config = null;
    this.hasJoined = false;       // first successful join happened
    this.intentionalClose = false; // user pressed Leave — don't reconnect
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  connect(config) {
    this.config = config;
    this.intentionalClose = false;
    this.#open();
  }

  #open() {
    // Same host, ws/wss matching the page protocol.
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}`);

    this.ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.#send({ type: "join", ...this.config });
    });

    this.ws.addEventListener("message", (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (msg.type === "joined") {
        this.peerId = msg.peerId;
        // A reconnect reuses the room+password but gets a brand-new
        // server-assigned id, so surface it distinctly from a first join.
        if (this.hasJoined) {
          this.dispatchEvent(new CustomEvent("rejoined", { detail: msg }));
        } else {
          this.hasJoined = true;
          this.dispatchEvent(new CustomEvent("joined", { detail: msg }));
        }
        return;
      }

      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    });

    this.ws.addEventListener("close", () => {
      if (this.intentionalClose) {
        this.dispatchEvent(new CustomEvent("closed"));
        return;
      }
      // Unexpected drop. Only try to reconnect if we were actually in a
      // room; a drop before the first join just fails the join outright.
      if (this.hasJoined) {
        this.#scheduleReconnect();
      } else {
        this.dispatchEvent(new CustomEvent("closed"));
      }
    });

    this.ws.addEventListener("error", () =>
      this.dispatchEvent(new CustomEvent("socket-error"))
    );
  }

  #scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.dispatchEvent(new CustomEvent("reconnect-failed"));
      this.dispatchEvent(new CustomEvent("closed"));
      return;
    }

    const delay = Math.min(
      BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_DELAY_MS
    );
    this.reconnectAttempts++;

    this.dispatchEvent(
      new CustomEvent("reconnecting", {
        detail: { attempt: this.reconnectAttempts, delayMs: delay },
      })
    );

    this.reconnectTimer = setTimeout(() => this.#open(), delay);
  }

  signal(to, data) {
    this.#send({ type: "signal", to, data });
  }

  rename(name) {
    this.#send({ type: "rename", name });
  }

  leave() {
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    this.#send({ type: "leave" });
    this.ws?.close();
  }

  #send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
