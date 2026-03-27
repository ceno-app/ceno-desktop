// Copyright (c) 2022, The Tor Project, Inc.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

"use strict";

/* import-globals-from /browser/components/preferences/preferences.js */
/* import-globals-from /browser/components/preferences/search.js */

const {
  CenoNetwork,
  CenoNetworkTopics,
  CenoNetworkErrors,
  internetStatusToL10n,
  InternetStatus,
  OuinetStages,
  ouinetStageToL10n
} = ChromeUtils.importESModule("resource://gre/modules/CenoNetwork.sys.mjs");

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

      ouinet_quickstart_toggle: document.getElementById("ouinet-connection-quickstart-toggle"),
      ouinet_headless_toggle: document.getElementById("ouinet-connection-headless-toggle"),

      sources: {
        origin_access: document.getElementById("ouinet-connection-origin-access"),
        proxy_access: document.getElementById("ouinet-connection-proxy-access"),
        injector_access: document.getElementById("ouinet-connection-injector-access"),
        distributed_cache: document.getElementById("ouinet-connection-distributed-cache"),

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

      logging_level: document.getElementById("logging-level"),

      metrics: document.getElementById("ouinet-metrics"),
      doh: document.getElementById("ouinet-doh"),
      unencrypted_dns: document.getElementById("ouinet-unencrypted-dns"),
      bridge: document.getElementById("ouinet-connection-bridge-toggle"),

      local_cache_size: document.getElementById("local-cache-size"),
      clear_cache_button: document.getElementById("clear-cache-button"),

      reachability: document.getElementById('reachability-status'),
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

  async observe(subject, topic) {
    switch (topic) {
      case CenoNetworkTopics.StateChange:
        this.#update_ui(subject?.wrappedJSObject);
        break;
    }
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
      CenoNetwork.setOuinetConfigValue('logging', true);
      CenoNetwork.connect();
    });
    this.#elements.ouinet_allow_firewall_button.addEventListener("click", () => {
      CenoNetwork.allowFirewall();
    });
    this.#elements.clear_cache_button.addEventListener("click", () => {
      CenoNetwork.purgeOuinetCache();
    });

    this.#elements.ouinet_quickstart_toggle.addEventListener("toggle", () => {
      CenoNetwork.setQuickstart(this.#elements.ouinet_quickstart_toggle.pressed);
    });

    this.#elements.ouinet_headless_toggle.addEventListener("toggle", () => {
      CenoNetwork.setHeadless(this.#elements.ouinet_headless_toggle.pressed);
    });

    this.#elements.sources.origin_access.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('origin_access', this.#elements.sources.origin_access.pressed);
    });
    this.#elements.sources.proxy_access.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('proxy_access', this.#elements.sources.proxy_access.pressed);
    });
    this.#elements.sources.injector_access.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('injector_access', this.#elements.sources.injector_access.pressed);
    });
    this.#elements.sources.distributed_cache.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('distributed_cache', this.#elements.sources.distributed_cache.pressed);
    });

    this.#elements.logging_level.addEventListener("change", (e) => {
      CenoNetwork.setOuinetConfigValue('logging_level', e.target.value);
    });

    this.#elements.metrics.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('metrics', this.#elements.metrics.pressed);
    });
    this.#elements.doh.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('doh', this.#elements.doh.pressed);
    });
    this.#elements.unencrypted_dns.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('unencrypted_dns', this.#elements.unencrypted_dns.pressed);
    });
    this.#elements.bridge.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('bridge', this.#elements.bridge.pressed);
    });

    this.#elements.udp_mux_port_random_toggle.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('udp_mux_port_random', this.#elements.udp_mux_port_random_toggle.pressed);
    });
    this.#elements.udp_mux_port.addEventListener("change", () => {
      const value = parseInt(this.#elements.udp_mux_port.value, 10);
      if (value >= 1 && value <= 65535) {
        CenoNetwork.setOuinetConfigValue('udp_mux_port', this.#elements.udp_mux_port.value);
      }
    });
  }

  init() {
    const onUnload = () => {
      window.removeEventListener("unload", onUnload);
      gConnectionPane.uninit();
    };
    window.addEventListener("unload", onUnload);

    this.#initElements();
    this.#addEventListeners();

    Services.obs.addObserver(this, CenoNetworkTopics.StateChange);
    this.#update_ui(CenoNetwork.CenoNetworkState());
  };

  uninit() {
    Services.obs.removeObserver(this, CenoNetworkTopics.StateChange);
  }

  #update_ui(state) {
    document.l10n.setAttributes(this.#elements.ouinet_connection_status, ouinetStageToL10n(state.ouinetStage, state.internetStatus));
    this.#elements.ouinet_quickstart_toggle.pressed = state.quickstart;
    this.#elements.ouinet_headless_toggle.pressed = state.headless;

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
          requested: String(state.udp_mux_port),
          actual: String(state.udp_mux_port_actual),
        }));
      this.#elements.errors.udp_mux_port_mismatch.hidden = false;
    } else
      this.#elements.errors.udp_mux_port_mismatch.hidden = true;

    this.#set_toggle(this.#elements.sources.origin_access, state.origin_access);
    this.#set_toggle(this.#elements.sources.proxy_access, state.proxy_access);
    this.#set_toggle(this.#elements.sources.injector_access, state.injector_access);
    this.#set_toggle(this.#elements.sources.distributed_cache, state.distributed_cache);

    if (state.origin_access === undefined || state.origin_access || state.proxy_access) {
      this.#elements.sources.personal_unreachable.hidden = 'true';
    } else {
      this.#elements.sources.personal_unreachable.removeAttribute('hidden');
    }

    if (state.origin_access === undefined || state.origin_access || state.injector_access || state.distributed_cache) {
      this.#elements.sources.public_unreachable.hidden = 'true';
    } else {
      this.#elements.sources.public_unreachable.removeAttribute('hidden');
    }

    if (state.logfile) {
      this.#elements.logfile_err_msg.href = 'file://' + state.logfile;
      this.#elements.logfile.href = 'file://' + state.logfile;
      this.#elements.logfile.removeAttribute('hidden');
    } else {
      this.#elements.logfile.hidden = true;
    }
    this.#elements.logging_level.value = state.logging_level;

    this.#set_toggle(this.#elements.metrics, state.metrics);
    this.#set_toggle(this.#elements.doh, state.doh);
    this.#set_toggle(this.#elements.unencrypted_dns, state.unencrypted_dns);
    this.#elements.unencrypted_dns.disabled = !state.doh;
    this.#set_toggle(this.#elements.bridge, state.bridge);

    this.#elements.clear_cache_button.hidden = state.local_cache_size === undefined;
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

    this.#elements.reachability.textContent = state.reachability;
    this.#elements.upnp.textContent = state.upnp;
    this.#elements.local_udp.textContent = state.local_udp;
    this.#elements.public_udp.textContent = state.public_udp;

    this.#set_toggle(this.#elements.udp_mux_port_random_toggle, state.udp_mux_port_random);
    this.#elements.udp_mux_port.value = state.udp_mux_port;

    this.#elements.udp_mux_port.disabled = state.udp_mux_port_random;
    this.#elements.udp_mux_port_label.disabled = state.udp_mux_port_random;
  }

  #set_toggle(element, value) {
    if (value === undefined) {
      element.disabled = true;
      element.pressed = undefined;
    } else {
      element.disabled = false;
      element.pressed = value;
    }
  };

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
};
const gConnectionPane = new ConnectionPane();
