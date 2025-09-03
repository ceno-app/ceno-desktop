// Copyright (c) 2025, eQualitie

// Copyright (c) 2021, The Tor Project, Inc.
// cenohome functionality is taken from TorConnect, this file is based on TorConnectParent.sys.mjs

import {
  CenoHome,
  CenoHomeTopics,
} from "resource://gre/modules/CenoHome.sys.mjs";

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
          case CenoHomeTopics.StateChange:
            self.sendAsyncMessage("cenohome:state-change", CenoHome.state);
            break;
          case CenoHomeTopics.QuickstartChange:
            self.sendAsyncMessage("cenohome:quickstart-change", CenoHome.quickstart);
            break;
          case CenoHomeTopics.InternetStatusChange:
            self.sendAsyncMessage("cenohome:internet-status-change", { internetStatus: CenoHome.internetStatus } );
            break;
        }
      },
    };

    Services.obs.addObserver(
      this.connectObserver,
      CenoHomeTopics.StateChange
    );
    Services.obs.addObserver(
      this.connectObserver,
      CenoHomeTopics.InternetStatusChange
    );
    Services.obs.addObserver(
      this.connectObserver,
      CenoHomeTopics.QuickstartChange
    );
  }

  didDestroy() {
    Services.obs.removeObserver(
      this.connectObserver,
      CenoHomeTopics.StateChange
    );
    Services.obs.removeObserver(
      this.connectObserver,
      CenoHomeTopics.InternetStatusChange
    );
    Services.obs.removeObserver(
      this.connectObserver,
      CenoHomeTopics.QuickstartChange
    );
  }

  async receiveMessage(message) {
    switch (message.name) {
      // case "cenohome:home-page":
      //   // If there are multiple home pages, just load the first one.
      //   return Promise.resolve(
      //     CenoHomeParent.fixupURIs(lazy.HomePage.get())[0]
      //   );
      case "cenohome:set-quickstart":
        CenoHome.quickstart = message.data;
        break;
      case "cenohome:connect":
        Services.prefs.setBoolPref(Prefs.userHasEverClickedConnect, true);
        CenoHome.connect();
        break;
      case "cenohome:cancel":
        CenoHome.cancel();
        break;
      case "cenohome:get-init-args":
        // Called on AboutCenoHome.init(), pass down all state data it needs
        // to init.
        return {
          Direction: Services.locale.isAppLocaleRTL ? "rtl" : "ltr",
          state: CenoHome.state,
          userHasEverClickedConnect: Services.prefs.getBoolPref(Prefs.userHasEverClickedConnect, false),
          quickstartEnabled: CenoHome.quickstart,
        };
    }
    return undefined;
  }
}
