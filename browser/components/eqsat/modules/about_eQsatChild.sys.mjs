export class about_eQsatChild extends JSWindowActorChild {
  #pendingState = null;

  actorCreated() {
    this.contentWindow?.addEventListener("eqsat:action", this);
    this.sendAsyncMessage("init");
  }

  didDestroy() {
    this.contentWindow?.removeEventListener("eqsat:action", this);
  }

  receiveMessage(msg) {
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    const doc = win.document;

    switch (msg.name) {
      case "state": {
        if (doc.readyState === "complete") {
          doc.dispatchEvent(new win.CustomEvent("eqsat:state", { detail: msg.data} ));
        } else {
          this.#pendingState = msg.data;
        }
        break;
      }
      case "results": {
        doc.dispatchEvent(new win.CustomEvent("eqsat:results", { detail: msg.data }));
        break;
      }
      case "queueItems": {
        doc.dispatchEvent(new win.CustomEvent("eqsat:queue", { detail: msg.data }));
        break;
      }
    }
  }

  handleEvent(event) {
    if (event.type === "eqsat:action") {
      const { action, payload } = event.detail;
      switch (action) {
        case "getResultsByIds":
          this.sendAsyncMessage("getResultsByIds", payload.ids);
          break;
        case "getQueueItemsByIds":
          this.sendAsyncMessage("getQueueItemsByIds", payload.ids);
          break;
        case "removeFromQueue":
          this.sendAsyncMessage("removeFromQueue", payload.id);
          break;
        case "cancelCurrentExtraction":
          this.sendAsyncMessage("cancelCurrentExtraction");
          break;
        case "cancelAll":
          this.sendAsyncMessage("cancelAll");
          break;
      }
    } else if (event.type === "DOMContentLoaded") {
      const win = this.contentWindow;
      if (this.#pendingState && win) {
        win.document.dispatchEvent(
          new win.CustomEvent("eqsat:state", { detail: this.#pendingState })
        );
        this.#pendingState = null;
      }
    }
  }
}
