import { eQsatExtractor } from "resource:///modules/eQsatExtractor.sys.mjs";

export class about_eQsatParent extends JSWindowActorParent {
  #obs = null;

  actorCreated() {
    this.#obs = (subj, topic, data) => {
      if (topic !== "eqsat:update") return;
      try {
        this.sendAsyncMessage("state", JSON.stringify(eQsatExtractor.getState()));
      } catch (e) {
        // child already gone
      }
    };
    Services.obs.addObserver(this.#obs, "eqsat:update");
  }

  didDestroy() {
    if (this.#obs) {
      Services.obs.removeObserver(this.#obs, "eqsat:update");
      this.#obs = null;
    }
  }

  receiveMessage(msg) {
    switch (msg.name) {
      case "init": {
        try {
          this.sendAsyncMessage("state", JSON.stringify(eQsatExtractor.getState()));
        } catch (e) {}
        break;
      }
      case "getResultsByIds": {
        const results = eQsatExtractor.getResultsByIds(msg.data);
        this.sendAsyncMessage("results", JSON.stringify(results));
        break;
      }
      case "getQueueItemsByIds": {
        const items = eQsatExtractor.getQueueItemsByIds(msg.data);
        this.sendAsyncMessage("queueItems", JSON.stringify(items));
        break;
      }
      case "removeFromQueue": {
        eQsatExtractor.removeFromQueue(msg.data);
        // extractor emits eqsat:update → state push
        break;
      }
      case "cancelCurrentExtraction": {
        eQsatExtractor.cancelCurrentExtraction();
        break;
      }
      case "cancelAll": {
        eQsatExtractor.cancelAll();
        break;
      }
    }
  }
}
