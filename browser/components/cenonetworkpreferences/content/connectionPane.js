// Copyright (c) 2022, The Tor Project, Inc.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

"use strict";

/* import-globals-from /browser/components/preferences/preferences.js */
/* import-globals-from /browser/components/preferences/search.js */

const { CenoNetwork, CenoNetworkTopics, internetStatusToL10n, OuinetStages, ouinetStageToL10n } =
  ChromeUtils.importESModule("resource://gre/modules/CenoNetwork.sys.mjs");

class ConnectionPane {
  #selectors = Object.freeze({
    internet_connection_status: "span#network-status-internet",
    ouinet_connection_status: "span#network-status-ouinet",
    ouinet_connect_button: "button#network-status-ouinet-connect-button",
    ouinet_disconnect_button: "button#network-status-ouinet-disconnect-button",
    ouinet_cancel_button: "button#network-status-ouinet-cancel-button",
    ouinet_quickstart_toggle: "moz-toggle#ouinet-connection-quickstart-toggle",
    ouinet_headless_toggle: "moz-toggle#ouinet-connection-headless-toggle",

    sources: {
      origin_access: "#ouinet-connection-origin-access",
      proxy_access: "#ouinet-connection-proxy-access",
      injector_access: "#ouinet-connection-injector-access",
      distributed_cache: "#ouinet-connection-distributed-cache",

      personal_unreachable: "#ouinet-connection-personal-unreachable",
      public_unreachable: "#ouinet-connection-public-unreachable",
    },

    logging: "moz-toggle#ouinet-logging",
    logfile: "a#ouinet-logfile",
    metrics: "moz-toggle#ouinet-metrics",
    doh: "moz-toggle#ouinet-doh",
    bridge: "moz-toggle#ouinet-connection-bridge-toggle",

    local_cache_size: "span#local-cache-size",
    clear_cache_button: "button#clear-cache-button",

    reachability: 'span#reachability-status',
    upnp: 'span#upnp-status',
    local_udp: 'span#local-udp',
    public_udp: 'span#public-udp',
  });

  #elements = {};
  #initElements() {
    this.#elements = Object.freeze({
      internet_connection_status: document.querySelector(this.#selectors.internet_connection_status),
      ouinet_connection_status: document.querySelector(this.#selectors.ouinet_connection_status),
      ouinet_connect_button: document.querySelector(this.#selectors.ouinet_connect_button),
      ouinet_cancel_button: document.querySelector(this.#selectors.ouinet_cancel_button),
      ouinet_disconnect_button: document.querySelector(this.#selectors.ouinet_disconnect_button),
      ouinet_quickstart_toggle: document.querySelector(this.#selectors.ouinet_quickstart_toggle),
      ouinet_headless_toggle: document.querySelector(this.#selectors.ouinet_headless_toggle),

      sources: {
        origin_access: document.querySelector(this.#selectors.sources.origin_access),
        proxy_access: document.querySelector(this.#selectors.sources.proxy_access),
        injector_access: document.querySelector(this.#selectors.sources.injector_access),
        distributed_cache: document.querySelector(this.#selectors.sources.distributed_cache),

        personal_unreachable: document.querySelector(this.#selectors.sources.personal_unreachable),
        public_unreachable: document.querySelector(this.#selectors.sources.public_unreachable),
      },

      logging: document.querySelector(this.#selectors.logging),
      logfile: document.querySelector(this.#selectors.logfile),
      metrics: document.querySelector(this.#selectors.metrics),
      doh: document.querySelector(this.#selectors.doh),
      bridge: document.querySelector(this.#selectors.bridge),

      local_cache_size: document.querySelector(this.#selectors.local_cache_size),
      clear_cache_button: document.querySelector(this.#selectors.clear_cache_button),

      reachability: document.querySelector(this.#selectors.reachability),
      upnp: document.querySelector(this.#selectors.upnp),
      local_udp: document.querySelector(this.#selectors.local_udp),
      public_udp: document.querySelector(this.#selectors.public_udp),
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
    })
    this.#elements.ouinet_disconnect_button.addEventListener("click", () => {
      CenoNetwork.cancel();
    })
    this.#elements.ouinet_cancel_button.addEventListener("click", () => {
      CenoNetwork.cancel();
    })
    this.#elements.clear_cache_button.addEventListener("click", () => {
      CenoNetwork.purgeOuinetCache();
    })

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

    this.#elements.logging.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('logging', this.#elements.logging.pressed);
    });

    this.#elements.metrics.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('metrics', this.#elements.metrics.pressed);
    });
    this.#elements.doh.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('doh', this.#elements.doh.pressed);
    });
    this.#elements.bridge.addEventListener("toggle", () => {
      CenoNetwork.setOuinetConfigValue('bridge', this.#elements.bridge.pressed);
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
    document.l10n.setAttributes(this.#elements.internet_connection_status, internetStatusToL10n(state.internetStatus));
    document.l10n.setAttributes(this.#elements.ouinet_connection_status, ouinetStageToL10n(state.ouinetStage));
    this.#elements.ouinet_quickstart_toggle.pressed = state.quickstart;
    this.#elements.ouinet_headless_toggle.pressed = state.headless;

    switch (state.ouinetStage) {
      case OuinetStages.Connected:
      case OuinetStages.Degraded:
        this.#elements.ouinet_connect_button.hidden = true;
        this.#elements.ouinet_cancel_button.hidden = true;
        this.#elements.ouinet_disconnect_button.hidden = false;
        break;

      case OuinetStages.StartingProcess:
      case OuinetStages.ConnectingToNetwork:
        this.#elements.ouinet_connect_button.hidden = true;
        this.#elements.ouinet_cancel_button.hidden = false;
        this.#elements.ouinet_disconnect_button.hidden = true;
        break;

      case OuinetStages.Init:
      case OuinetStages.Exited:
      case OuinetStages.Error:
      default:
        this.#elements.ouinet_connect_button.hidden = false;
        this.#elements.ouinet_cancel_button.hidden = true;
        this.#elements.ouinet_disconnect_button.hidden = true;
        break;
    }

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

    this.#set_toggle(this.#elements.logging, state.logging);
    if (state.logging) {
      this.#elements.logfile.href = 'file://' + state.logfile;
      this.#elements.logfile.innerHTML = 'log.txt';
      this.#elements.logfile.removeAttribute('hidden');
    } else {
      this.#elements.logfile.hidden = 'true';
    }
    this.#set_toggle(this.#elements.metrics, state.metrics);
    this.#set_toggle(this.#elements.doh, state.doh);
    this.#set_toggle(this.#elements.bridge, state.bridge);

    // @TODO: cache size unknown
    this.#elements.clear_cache_button.hidden = state.local_cache_size === undefined;
    this.#elements.local_cache_size.textContent = state.local_cache_size === undefined ? "???" : this.#calculateSize(state.local_cache_size);

    this.#elements.reachability.textContent = state.reachability;
    this.#elements.upnp.textContent = state.upnp;
    this.#elements.local_udp.textContent = state.local_udp;
    this.#elements.public_udp.textContent = state.public_udp;
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
