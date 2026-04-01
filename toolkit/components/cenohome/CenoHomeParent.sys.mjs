// Copyright (c) 2025, eQualitie

// Copyright (c) 2021, The Tor Project, Inc.
// cenohome functionality is taken from TorConnect, this file is based on TorConnectParent.sys.mjs

import {
  CenoNetwork,
  CenoNetworkTopics,
  OuinetPrefs,
} from "resource://gre/modules/CenoNetwork.sys.mjs";

const Prefs = Object.freeze({
  userHasEverClickedConnect: "ceno.cenohome:user_has_ever_clicked_connect"
});

// Keep CenoHomeTopics in sync with aboutCenoHome.js
const CenoHomeTopics = Object.freeze({
  GetInitArgs: "cenohome:get-init-args",
  StateChange: "cenohome:state-change",
  Connect: "cenohome:connect",
  Cancel: "cenohome:cancel",
  SetQuickstart: "cenohome:set-quickstart",
  QuickstartChange: "cenohome:quickstart-change",
  OpenConnectionPreferences: "cenohome:openconnectionpreferences",
  ShowLogFile: "cenohome:showlogfile",
  EnableLoggingAndReconnect: "cenohome:enableloggingandreconnect",
  AllowFirewall: "cenohome:allowfirewall",
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
            obj.quickstart = Services.prefs.getBoolPref(OuinetPrefs.quickstart);
            self.sendAsyncMessage(CenoHomeTopics.StateChange, obj);
            break;
        }
      },
    };

    Services.obs.addObserver(this.connectObserver, CenoNetworkTopics.StateChange);

    this.quickstartObserver = {
      observe(_subject, _topic, _data) {
        self.sendAsyncMessage(CenoHomeTopics.QuickstartChange, Services.prefs.getBoolPref(OuinetPrefs.quickstart));
      }
    };
    this.quickstartBranch = Services.prefs.getBranch(OuinetPrefs.quickstart);
    this.quickstartBranch.addObserver("", this.quickstartObserver);
  }

  didDestroy() {
    if (this.quickstartBranch) {
      this.quickstartBranch.removeObserver("", this.quickstartObserver);
      this.quickstartBranch = null;
    }
    Services.obs.removeObserver(this.connectObserver, CenoNetworkTopics.StateChange);
  }

  async receiveMessage(message) {
    switch (message.name) {
      case CenoHomeTopics.SetQuickstart:
        Services.prefs.setBoolPref(OuinetPrefs.quickstart, message.data);
        break;
      case CenoHomeTopics.Connect:
        Services.prefs.setBoolPref(Prefs.userHasEverClickedConnect, true);
        CenoNetwork.connect();
        break;
      case CenoHomeTopics.Cancel:
        CenoNetwork.cancel();
        break;
      case CenoHomeTopics.GetInitArgs:
        // Called on AboutCenoHome.init(), pass down all state data it needs
        // to init.
        return {
          Direction: Services.locale.isAppLocaleRTL ? "rtl" : "ltr",
          state: CenoNetwork.CenoNetworkState(),
          userHasEverClickedConnect: Services.prefs.getBoolPref(Prefs.userHasEverClickedConnect, false),
        };
      case CenoHomeTopics.OpenConnectionPreferences:
        Services.wm.getMostRecentWindow("navigator:browser").gBrowser.addTab(
          "about:preferences#connection", {
            inBackground: false,
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          }
        );
        break;
      case CenoHomeTopics.ShowLogFile:
        // @TODO:
        console.log("CenoHomeParent: ", CenoHomeTopics.ShowLogFile);
        CenoNetwork.showLogFile();
        break;
      case CenoHomeTopics.EnableLoggingAndReconnect:
        CenoNetwork.enableLoggingAndConnect();
        break;
      case CenoHomeTopics.AllowFirewall:
        CenoNetwork.allowFirewall();
        break;
    }
    return undefined;
  }
}
