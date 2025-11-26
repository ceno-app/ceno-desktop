// Copyright (c) 2025, eQualitie

// Copyright (c) 2021, The Tor Project, Inc.
// cenohome functionality is taken from TorConnect, this file is based on TorConnectParent.sys.mjs

import {
  CenoNetwork,
  CenoNetworkTopics,
} from "resource://gre/modules/CenoNetwork.sys.mjs";

const Prefs = Object.freeze({
  userHasEverClickedConnect: "ceno.cenohome:user_has_ever_clicked_connect"
});

/*
This object is basically a marshalling interface between the CenoHome module
and a particular about:cenohome page
*/

/**
 * Actor parent class for the about:torconnect page.
 * It adapts and relays the messages from and to the CenoHome module.
 */
export class CenoHomeParent extends JSWindowActorParent {
  constructor(...args) {
    super(...args);

    const self = this;

    // JSWindowActiveParent derived objects cannot observe directly, so create a
    // member object to do our observing for us.
    //
    // This object converts the various lifecycle events from the CenoHome
    // module, and maintains a state object which we pass down to our
    // about:torconnect page, which uses the state object to update its UI.
    this.connectObserver = {
      observe(subject, topic) {
        const obj = subject?.wrappedJSObject;
        switch (topic) {
          case CenoNetworkTopics.StateChange:
            self.sendAsyncMessage(CenoNetworkTopics.StateChange, obj);
            break;
        }
      },
    };

    Services.obs.addObserver(
      this.connectObserver,
      CenoNetworkTopics.StateChange
    );
  }

  didDestroy() {
    Services.obs.removeObserver(
      this.connectObserver,
      CenoNetworkTopics.StateChange
    );
  }

  async receiveMessage(message) {
    switch (message.name) {
      // case "cenohome:home-page":
      //   // If there are multiple home pages, just load the first one.
      //   return Promise.resolve(
      //     CenoHomeParent.fixupURIs(lazy.HomePage.get())[0]
      //   );
      case CenoNetworkTopics.SetQuickstart:
        CenoNetwork.setQuickstart(message.data);
        break;
      case CenoNetworkTopics.Connect:
        Services.prefs.setBoolPref(Prefs.userHasEverClickedConnect, true);
        CenoNetwork.connect();
        break;
      case CenoNetworkTopics.Cancel:
        CenoNetwork.cancel();
        break;
      case "cenohome:get-init-args":
        // Called on AboutCenoHome.init(), pass down all state data it needs
        // to init.
        return {
          Direction: Services.locale.isAppLocaleRTL ? "rtl" : "ltr",
          state: CenoNetwork.CenoNetworkState(),
          userHasEverClickedConnect: Services.prefs.getBoolPref(Prefs.userHasEverClickedConnect, false),
        };
    }
    return undefined;
  }
}
