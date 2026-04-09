// Copyright (c) 2022, The Tor Project, Inc.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

"use strict";

/* import-globals-from /browser/components/preferences/preferences.js */
/* import-globals-from /browser/components/preferences/search.js */
/* import-globals-from preferences.js */

const {
  CenoNetwork,
  CenoNetworkTopics,
  CenoNetworkErrors,
  internetStatusToL10n,
  InternetStatus,
  OuinetStages,
  ouinetStageToL10n,
  OuinetPrefs,
} = ChromeUtils.importESModule("resource://gre/modules/CenoNetwork.sys.mjs");

Preferences.addAll([
  { id: OuinetPrefs.quickstart, type: "bool" },
  { id: OuinetPrefs.headless, type: "bool" },

  { id: OuinetPrefs.origin_access, type: "bool" },
  { id: OuinetPrefs.proxy_access, type: "bool" },
  { id: OuinetPrefs.injector_access, type: "bool" },
  { id: OuinetPrefs.distributed_cache, type: "bool" },
  { id: OuinetPrefs.logging_level, type: "string" },
  { id: OuinetPrefs.metrics, type: "bool" },
  { id: OuinetPrefs.doh, type: "int" },
  { id: OuinetPrefs.bridge, type: "bool" },
  { id: OuinetPrefs.udp_mux_port, type: "int" },
  { id: OuinetPrefs.udp_mux_port_random, type: "bool" },
]);

class ConnectionPane {
  #elements = {};

  #initElements() {
    this.#elements = Object.freeze({
      ouinet_connection_status: document.getElementById("network-status-ouinet"),
      ouinet_connect_button: document.getElementById("network-status-ouinet-connect-button"),
      ouinet_cancel_button: document.getElementById("network-status-ouinet-cancel-button"),
      ouinet_disconnect_button: document.getElementById("network-status-ouinet-disconnect-button"),
      ouinet_enableloggingandreconnect_button: document.getElementById("network-status-ouinet-enableloggingandreconnect-button"),
      ouinet_allow_firewall_button: document.getElementById("network-status-ouinet-allow-firewall-button"),
      sources: {
        personal_unreachable: document.getElementById("ouinet-connection-personal-unreachable"),
        public_unreachable: document.getElementById("ouinet-connection-public-unreachable"),
      },

      errors: {
        link_status_offline: document.getElementById("error-message-link-status-offline"),
        firewall: document.getElementById("error-message-firewall"),
        failed_to_start: document.getElementById("error-message-failed-to-start"),
        failed_to_start_show_log: document.getElementById("error-message-failed-to-start-show-log"),
        udp_mux_port_mismatch: document.getElementById("error-message-udp-port-mismatch"),
      },
      local_cache_size: document.getElementById("local-cache-size"),
      clear_cache_button: document.getElementById("clear-cache-button"),

      upnp: document.getElementById('upnp-status'),
      local_udp: document.getElementById('local-udp'),
      public_udp: document.getElementById('public-udp'),

      logfile_err_msg: document.getElementById("showlogfile_err_msg"),
      logfile: document.getElementById("showlogfile"),

      udp_mux_port_random_toggle: document.getElementById("udp-mux-port-random-toggle"),
      udp_mux_port: document.getElementById("udp-mux-port"),
      udp_mux_port_label: document.getElementById("udp-mux-port-label"),
    });
  }

  #addEventListeners() {
    this.#elements.ouinet_connect_button.addEventListener("click", () => {
      CenoNetwork.connect();
    });
    this.#elements.ouinet_disconnect_button.addEventListener("click", () => {
      CenoNetwork.cancel();
    });
    this.#elements.ouinet_cancel_button.addEventListener("click", () => {
      CenoNetwork.cancel();
    });
    this.#elements.ouinet_enableloggingandreconnect_button.addEventListener("click", () => {
      CenoNetwork.enableLoggingAndConnect();
    });
    this.#elements.ouinet_allow_firewall_button.addEventListener("click", () => {
      CenoNetwork.allowFirewall();
    });
    this.#elements.clear_cache_button.addEventListener("click", () => {
      CenoNetwork.purgeOuinetCache();
    });
  }

  #prefs;
  init() {
    const onUnload = () => {
      window.removeEventListener("unload", onUnload);
      gConnectionPane.uninit();
    };
    window.addEventListener("unload", onUnload);

    this.#initElements();
    this.#addEventListeners();

    this.#prefs = Services.prefs.getBranch("");
    this.#prefs.addObserver(OuinetPrefs.udp_mux_port_random, this);
    Services.obs.addObserver(this, CenoNetworkTopics.StateChange);
    this.#update_ui(CenoNetwork.CenoNetworkState());
  };

  uninit() {
    this.#prefs.removeObserver("", this);
    this.#prefs = null;
    Services.obs.removeObserver(this, CenoNetworkTopics.StateChange);
  }

  #update_ui(state) {
    document.l10n.setAttributes(this.#elements.ouinet_connection_status, ouinetStageToL10n(state.ouinetStage, state.internetStatus));

    this.#elements.ouinet_connect_button.hidden = true;
    this.#elements.ouinet_cancel_button.hidden = true;
    this.#elements.ouinet_disconnect_button.hidden = true;
    switch (state.ouinetStage) {
      case OuinetStages.Connected:
      case OuinetStages.Degraded:
        this.#elements.ouinet_disconnect_button.hidden = false;
        break;

      case OuinetStages.StartingProcess:
      case OuinetStages.ConnectingToNetwork:
        this.#elements.ouinet_cancel_button.hidden = false;
        break;

      case OuinetStages.Init:
      case OuinetStages.Exited:
      case OuinetStages.Error:
        this.#elements.ouinet_connect_button.hidden = false;
        break;
    }

    this.#elements.errors.link_status_offline.hidden = state.internetStatus === InternetStatus.Online;
    this.#elements.errors.firewall.hidden = !state.errors.firewall;
    this.#elements.ouinet_allow_firewall_button.hidden = !state.errors.firewall;
    this.#elements.ouinet_enableloggingandreconnect_button.hidden = !state.errors.failed_to_start_suggest_logging;
    this.#elements.errors.failed_to_start.hidden = !state.errors.failed_to_start && !state.errors.failed_to_start_suggest_logging;
    this.#elements.errors.failed_to_start_show_log.hidden = !state.errors.failed_to_start_show_log;

    if (state.errors.udp_mux_port_mismatch) {
      this.#elements.errors.udp_mux_port_mismatch
        .setAttribute("data-l10n-args", JSON.stringify({
          requested: String(state.udp_mux_port_requested),
          actual: String(state.udp_mux_port_actual),
        }));
    }
    this.#showOrHide(this.#elements.errors.udp_mux_port_mismatch, state.errors.udp_mux_port_mismatch);

    const mux_port_random = Services.prefs.getBoolPref(OuinetPrefs.udp_mux_port_random);
    this.#elements.udp_mux_port.disabled = mux_port_random;
    this.#elements.udp_mux_port_label.disabled = mux_port_random;

    this.#showOrHide(this.#elements.sources.personal_unreachable, state.personal_unreachable);
    this.#showOrHide(this.#elements.sources.public_unreachable, state.public_unreachable);

    if (state.logfile) {
      this.#elements.logfile_err_msg.href = 'file://' + state.logfile;
      this.#elements.logfile.href = 'file://' + state.logfile;
    }
    this.#showOrHide(this.#elements.logfile, state.logfile);

    if (state.local_cache_size !== undefined) {
      document.l10n.setAttributes(
        this.#elements.local_cache_size,
        "ceno-browser-ouinet-preferences-local-cache-size", { size: this.#calculateSize(state.local_cache_size) }
      );
    } else {
      document.l10n.setAttributes(
        this.#elements.local_cache_size,
        "ceno-browser-ouinet-preferences-local-cache-size-unknown"
      );
    }
    this.#showOrHide(this.#elements.clear_cache_button, state.local_cache_size !== undefined);

    this.#elements.upnp.textContent = state.upnp;
    this.#elements.local_udp.textContent = state.local_udp;
    this.#elements.public_udp.textContent = state.public_udp;
  }

  observe(subject, topic, _data) {
    if (topic === CenoNetworkTopics.StateChange) {
      this.#update_ui(subject?.wrappedJSObject);
      return;
    }

    // if (topic === "nsPref:changed") {}
    const udp_mux_port_random = Services.prefs.getBoolPref(OuinetPrefs.udp_mux_port_random);
    this.#elements.udp_mux_port.disabled = udp_mux_port_random;
    this.#elements.udp_mux_port_label.disabled = udp_mux_port_random;
  }

  #calculateSize(value) {
    var b = Number(value);
    if (isNaN(b)) {
      b = 0;
    }
    if (b < 1024) {
      return b + " B";
    }
    // See <https://stackoverflow.com/a/42408230>.
    var i = Math.floor(Math.log2(b) / 10);
    var v = b / Math.pow(1024, i);
    var u = "KMGTPEZY"[i-1] + "iB";
    return `${v.toFixed(2)} ${u}`;
  };

  #showOrHide(element, shouldShow) {
    if (shouldShow) {
      element.removeAttribute('hidden');
    } else {
      element.hidden = 'true';
    }
  }
};
const gConnectionPane = new ConnectionPane();
