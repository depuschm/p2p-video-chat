export class Signaling extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.peerId = null;
  }

  connect({ room, password, name }) {
    // Same host, ws/wss matching the page protocol.
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}`);

    this.ws.addEventListener("open", () => {
      this.#send({ type: "join", room, password, name });
    });

    this.ws.addEventListener("message", (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "joined") this.peerId = msg.peerId;
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    });

    this.ws.addEventListener("close", () =>
      this.dispatchEvent(new CustomEvent("closed"))
    );
    this.ws.addEventListener("error", () =>
      this.dispatchEvent(new CustomEvent("socket-error"))
    );
  }

  signal(to, data) {
    this.#send({ type: "signal", to, data });
  }

  rename(name) {
    this.#send({ type: "rename", name });
  }

  leave() {
    this.#send({ type: "leave" });
    this.ws?.close();
  }

  #send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
