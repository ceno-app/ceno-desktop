import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { AsyncSocket } from "resource://gre/modules/AsyncSocket.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  MissingDataDirError: "resource://gre/modules/OuinetProcess.sys.mjs",
  MissingOuinetBinaryError: "resource://gre/modules/OuinetProcess.sys.mjs",
  OuinetStartupError: "resource://gre/modules/OuinetProcess.sys.mjs",
  OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
  OuinetProcess: "resource://gre/modules/OuinetProcess.sys.mjs",
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "NetworkLinkService", () => {
  // NetworkLinkService is unavailable on some platforms like openBSD.
  // See tor-browser#43628.
  return Cc["@mozilla.org/network/network-link-service;1"]?.getService(
    Ci.nsINetworkLinkService
  );
});

const NETWORK_LINK_TOPIC = Object.freeze("network:link-status-changed");

// keep OuinetPrefs in sync with connectionPane.inc.xhtml
export const OuinetPrefs = Object.freeze({
  browser_log_level: "ceno.browser.log_level",

  quickstart: "ceno.network.quickstart",
  headless: "ceno.network.headless",
  bridge: "ceno.network.bridge",

  origin_access: "ceno.network.origin_access",
  proxy_access: "ceno.network.proxy_access",
  injector_access: "ceno.network.injector_access",
  distributed_cache: "ceno.network.distributed_cache",

  logging_level: "ceno.network.logging_level",
  metrics: "ceno.network.metrics",

  // doh: "network.trr.mode",
  doh: "ceno.network.doh_mode",

  udp_mux_port: "ceno.network.udp_mux_port",
  udp_mux_port_random: "ceno.network.udp_mux_port_random",
});
const OuinetPrefsBranch = Services.prefs.getBranch("ceno.network.");

export const DNS_Mode_DoH_Fallback_to_Plain = 2;
export const DNS_Mode_DoH = 3;
export const DNS_Mode_Plain = 5;

ChromeUtils.defineLazyGetter(lazy, "logger", () =>
  console.createInstance({
    maxLogLevelPref: OuinetPrefs.browser_log_level,
    prefix: "CenoNetwork",
  })
);

const Secrets = Object.freeze({
  origin: "chrome://ceno",
  proxy_realm: "Ouinet Proxy",
  frontend_realm: "Ouinet Frontend",
});

export const InternetStatus = Object.freeze({
  Unknown: -1,
  Offline: 0,
  Online: 1,
});
export function internetStatusToL10n(status) {
  switch (status) {
    case InternetStatus.Online:
      return "ceno-browser-ouinet-preferences-internet-connection-status-online";
    case InternetStatus.Offline:
      return "ceno-browser-ouinet-preferences-internet-connection-status-offline";
    default:
      return "ceno-browser-ouinet-preferences-internet-connection-status-unknown";
  }
};

// Keep OuinetStages in sync with aboutCenoHome.js and ouinetConnectTitlebarStatus.js
export const OuinetStages = Object.freeze({
  Init: "Init",
  StartingProcess: "StartingProcess",
  ConnectingToNetwork: "ConnectingToNetwork",
  Connected: "Connected",
  Degraded: "Degraded",
  Exiting: "Exiting",
  Restarting: "Restarting",
  Exited: "Exited",
  Error: "Error",
});

// Keep ouinetStageToL10n in sync with ouinetConnectTitlebarStatus.js
export function ouinetStageToL10n(state, internetStatus) {
  switch (state) {
    case OuinetStages.Connected:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-connected";

    case OuinetStages.Degraded:
      if (internetStatus === InternetStatus.Online)
        return "ceno-browser-ouinet-preferences-ouinet-connection-status-degraded";
      else
        return "ceno-browser-ouinet-preferences-ouinet-connection-status-local-cache"

    case OuinetStages.StartingProcess:
    case OuinetStages.ConnectingToNetwork:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-connecting";

    case OuinetStages.Error:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-error";

    case OuinetStages.Exiting:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-exiting";
    case OuinetStages.Restarting:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-restarting";

    case OuinetStages.Init:
    case OuinetStages.Exited:
    default:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-not-connected";
  }
};

export const CenoNetworkTopics = Object.freeze({
  StateChange: "cenonetwork:state-change",
  Connect: "cenonetwork:connect",
  Cancel: "cenonetwork:cancel",
});

function randomString(length) {
  const dict = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const dlen = dict.length;

  const values = new Uint8Array(length);
  crypto.getRandomValues(values);

  let result = '';
  for (const randuint of values) {
    result += dict.charAt(randuint % dlen);
  }

  return result;
}

class _CenoNetwork {
  #ouinetStage = OuinetStages.Init;
  #internetStatus = InternetStatus.Unknown;
  #ouinetProcess = null;
  #connectionId = 0;

  #credentials = {
    proxy_user: 'ceno',
    proxy_password: null,
    frontend_token: null,
  }
  #endpoints = {
    proxy: null,
    frontend_unix_socket: lazy.OuinetLauncherUtil.getOuinetFile("frontend_unix_socket", false),
    frontend_tcp: null,

    frontend_get_api_status: '/api/status',
    frontend_set_value: '/',
    frontend_get_endpoints: '/api/endpoints',
    frontend_metrics_set_key: '/api/metrics/set_key_value',
  }

  #metricsRegion = Services.OuinetNativeHelpers.region;
  #metricsTimezone = Services.OuinetNativeHelpers.timezone;
  #metricsRecordId = undefined;

  // Some state values need to survive network client restart
  #ouinetState = {
    connection_was_made: false,
    blocked_by_firewall: false,
    errors: {
      firewall: false,
    },
  };
  // Other state values should be recreated for each connection
  #initOuinetState() {
    this.#ouinetState.local_cache_size = undefined;

    this.#ouinetState.reachability = undefined;
    this.#ouinetState.upnp = undefined;
    this.#ouinetState.local_udp = undefined;
    this.#ouinetState.public_udp = undefined;

    this.#ouinetState.errors.failed_to_start = false;
    this.#ouinetState.errors.failed_to_start_show_log = false;
    this.#ouinetState.errors.failed_to_start_suggest_logging = false;
    this.#ouinetState.errors.udp_mux_port_mismatch = false;
    this.#ouinetState.udp_mux_port_actual = 0;
    this.#ouinetState.udp_mux_port_requested = 0;

    this.#ouinetState.personal_unreachable = !Services.prefs.getBoolPref(OuinetPrefs.origin_access) && !Services.prefs.getBoolPref(OuinetPrefs.proxy_access);
    this.#ouinetState.public_unreachable = !Services.prefs.getBoolPref(OuinetPrefs.origin_access) && !Services.prefs.getBoolPref(OuinetPrefs.injector_access) && !Services.prefs.getBoolPref(OuinetPrefs.distributed_cache);
  }

  CenoNetworkState() {
    let res = structuredClone(this.#ouinetState);
    res['ouinetStage'] = this.#ouinetStage;
    res['internetStatus'] = this.#internetStatus;
    const logfile = lazy.OuinetLauncherUtil.getOuinetFile("logfile", false);
    const loggingLevel = Services.prefs.getStringPref(OuinetPrefs.logging_level);
    res['logfile'] = loggingLevel !== "disabled" && logfile.exists() ? logfile.path : false;
    return res;
  }

  #sendNotifications() {
    Services.obs.notifyObservers(this.CenoNetworkState(), CenoNetworkTopics.StateChange);
    if (
      this.#ouinetStage === OuinetStages.Degraded ||
      this.#ouinetStage === OuinetStages.Connected
    ) {
      this.#extensionOnConnect();
    } else {
      this.#extensionOnDisconnect();
    }
  }

  async #updateInternetStatus() {
    let newStatus = InternetStatus.Unknown;
    if (lazy.NetworkLinkService?.linkStatusKnown) {
      newStatus = lazy.NetworkLinkService.isLinkUp ? InternetStatus.Online : InternetStatus.Offline;
    }
    if (this.#internetStatus === newStatus) {
      return;
    }
    this.#internetStatus = newStatus;
    this.#sendNotifications();
  }

  #setOuinetStage(newStageName, sendNotifications) {
    if (this.#ouinetStage === newStageName) {
      return;
    }

    if (newStageName === OuinetStages.Connected || newStageName === OuinetStages.Degraded) {
      this.#ouinetState.connection_was_made = true;
      if (this.#ouinetState.blocked_by_firewall) {
        this.#ouinetState.errors.firewall = true;
      }
    }

    this.#ouinetStage = newStageName;
    if (sendNotifications) {
      this.#sendNotifications();
    }
  }

  // init() is called by OuinetStartupService
  async init() {
    this.#initOuinetState();
    if (!Services.prefs.prefHasUserValue(OuinetPrefs.doh) && this.#metricsRegion[1] === "R" && this.#metricsRegion[0] === "I") {
      Services.prefs.setIntPref(OuinetPrefs.doh, DNS_Mode_Plain);
    }

    Services.obs.addObserver(this, NETWORK_LINK_TOPIC);
    OuinetPrefsBranch.addObserver("", this);
    await this.#updateInternetStatus();

    await this.#loadOuinetCredentials();
    try {
      Services.OuinetNativeHelpers.MonitorFirewall(
        lazy.OuinetLauncherUtil.getOuinetFile("client", false).path,
        this,
        Services.prefs.getBoolPref(OuinetPrefs.udp_mux_port_random) ? 65535 : Services.prefs.getIntPref(OuinetPrefs.udp_mux_port)
      );
    } catch (e) { lazy.logger.error(e); }

    if (lazy.OuinetProcess.pidExists()) {
      lazy.logger.debug('Trying to inherit previous Ceno Network Connection');
      const connectionId = Number(++this.#connectionId);

      this.#ouinetProcess = new lazy.OuinetProcess((exitCode) => { this.#onOuinetExit(connectionId, exitCode); });
      this.#ouinetProcess.inherit();

      if (await this.#getApiEndpoints()) {
        if (connectionId !== this.#connectionId) {
          lazy.logger.debug("Abandoning cancelled connection attempt");
          return;
        }
        lazy.logger.info('Endpoints found, inheriting previous Ceno Network Connection');
        this.#setOuinetStage(OuinetStages.ConnectingToNetwork, true);

        this.#pollApiStatus(connectionId);
      } else {
        lazy.logger.debug('Endpoints unavailable, cannot inherit previous Ceno Network Connection. Terminating previous process');
        if (this.#ouinetProcess != null) {
          this.#ouinetProcess.stop();
        }
        if (Services.prefs.getBoolPref(OuinetPrefs.quickstart)) {
          this.#executeAfterOuinetExits(() => {
            lazy.logger.debug('Quickstart enabled');
            this.connect();
          });
        }
      }
    } else if (Services.prefs.getBoolPref(OuinetPrefs.quickstart)) {
      lazy.logger.debug('Quickstart enabled');
      this.connect();
    }
  }

  uninit() {
    OuinetPrefsBranch.removeObserver("", this);
    Services.obs.removeObserver(this, NETWORK_LINK_TOPIC);
    if (!Services.prefs.getBoolPref(OuinetPrefs.headless)) {
      this.cancel();
    }
  }

  async #getFromOuinetFrontend(url) {
    let socket = AsyncSocket.fromIpcFile(this.#endpoints.frontend_unix_socket);
    await socket.write(
      `GET ${url} HTTP/1.1\r\n` +
      `X-Ouinet-Front-End-Token: ${this.#credentials.frontend_token}\r\n` +
      '\r\n'
    );
    const response = await socket.read();

    const header_and_body = response.split("\r\n\r\n", 2);
    const header = header_and_body[0].split("\r\n");

    const isOk = header[0].includes('200');
    if (!isOk) {
      throw new Error("Frontend request failed: ", header_and_body);
    }
    return {
      ok: isOk,
      header: header,
      body: header_and_body.length === 2 ? header_and_body[1] : null,
      json: async function() {
        return JSON.parse(header_and_body[1]);
      }
    };
  }

  async #getApiEndpoints() {
    try {
      const response = await this.#getFromOuinetFrontend(this.#endpoints.frontend_get_endpoints);
      const json = await response.json();
      this.#endpoints.proxy = json.proxy_endpoint;
      this.#endpoints.frontend_tcp = 'http://' + json.frontend_tcp_endpoint;
      return true;
    } catch (e) {
      lazy.logger.info('Failed to get ouinet endpoints', e);
    }
    return false;
  }

  // Any API update should immediatelly be followed by #pollApiStatus.
  // This is why there's 2 places which resolve the #pollApiStatus's timeout:
  // 1: the loop in #pollApiStatus itself
  // 2: after setting value in setValueInAPI
  #apiPollTimeoutResolveData = {
    did_resolve: true,
    resolver: null,
    timeout: null,
  };
  #apiPollTimeoutResolver() {
    if (!this.#apiPollTimeoutResolveData.did_resolve && this.#apiPollTimeoutResolveData.resolver) {
      this.#apiPollTimeoutResolveData.did_resolve = true;
      this.#apiPollTimeoutResolveData.resolver();
      clearTimeout(this.#apiPollTimeoutResolveData.timeout);
    }
  }

  async #pollApiStatus(connectionId) {
    const interval_startup = 1000;
    const interval_runtime = 5000;
    while (
      connectionId === this.#connectionId && (
      this.#ouinetStage === OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage === OuinetStages.Degraded ||
      this.#ouinetStage === OuinetStages.Connected
    )) {
      try {
        const response = await this.#getFromOuinetFrontend(this.#endpoints.frontend_get_api_status);
        const json = await response.json();
        if (connectionId !== this.#connectionId) {
          return;
        }
        this.#ouinetState.local_cache_size = json.local_cache_size;
        this.#ouinetState.reachability = json.udp_world_reachable;
        this.#ouinetState.upnp = json.is_upnp_active;
        this.#ouinetState.local_udp = json.local_udp_endpoints.join(', ');
        this.#ouinetState.public_udp = json.public_udp_endpoints.join(', ');

        if (json.local_udp_endpoints.length >= 1) {
          const ep = json.local_udp_endpoints[0].split(':');
          if (ep.length === 2) {
            const portNum = parseInt(ep[1], 10);
            if (portNum !== 0) {
              if (this.#ouinetState.udp_mux_port_actual !== portNum) {
                Services.OuinetNativeHelpers.ModifyFirewallMonitorPort(portNum);
                const udp_mux_port = Services.prefs.getIntPref(OuinetPrefs.udp_mux_port);
                this.#ouinetState.errors.udp_mux_port_mismatch = !Services.prefs.getBoolPref(OuinetPrefs.udp_mux_port_random)
                  && udp_mux_port != portNum;
                this.#ouinetState.udp_mux_port_requested = udp_mux_port;
                this.#ouinetState.udp_mux_port_actual = portNum;
              }
            }
          }
        }
        if (json.state === 'started') {
          this.#setOuinetStage(OuinetStages.Connected, false);
        }
        else if (json.state === 'degraded') {
          this.#setOuinetStage(OuinetStages.Degraded, false);
        }
        this.#sendNotifications();

        if (this.#metricsRecordId != json.current_metrics_record_id && json.metrics_enabled) {
          this.#metricsRecordId = json.current_metrics_record_id;

          try {
            await this.#sendMetrics('APP_VERSION', lazy.AppConstants.BASE_BROWSER_VERSION);
            await this.#sendMetrics('NETWORK_COUNTRY', this.#metricsRegion);
            await this.#sendMetrics('NETWORK_COUNTRY_CONFIDENCE', "1");
            await this.#sendMetrics('TIMEZONE', this.#metricsTimezone);
            await this.#sendMetrics('BRIDGE_OPT_IN', this.#ouinetState.bridge ? "true" : "false");
          } catch (e) {
            lazy.logger.error('Metrics failed: ', e);
          }
        }
      } catch (e) {
        lazy.logger.error('Failed to get ouinet API status', e);
        if (this.#ouinetStage === OuinetStages.ConnectingToNetwork) {
          break;
        }
      }

      const poll_interval = this.#ouinetStage !== OuinetStages.Connected ? interval_startup : interval_runtime;
      await new Promise(resolve => {
        this.#apiPollTimeoutResolveData.did_resolve = false;
        this.#apiPollTimeoutResolveData.resolver = resolve;
        this.#apiPollTimeoutResolveData.timeout = setTimeout(() => this.#apiPollTimeoutResolver(), poll_interval);
      });
    }
  }

  async #sendMetrics(key, value) {
    lazy.logger.debug(`Sending metrics '${key}'='${value}'`);
    await this.#getFromOuinetFrontend(`${this.#endpoints.frontend_metrics_set_key}?record_id=${this.#metricsRecordId}&key=${key}&value=${value}`);
  }

  async #restartIfRunning() {
    const connectionId = this.#connectionId;
    while (
      connectionId === this.#connectionId && (
      this.#ouinetStage === OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage === OuinetStages.StartingProcess
    )) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (
      connectionId === this.#connectionId && (
      this.#ouinetStage == OuinetStages.Connected ||
      this.#ouinetStage == OuinetStages.Degraded
    )) {
      this.#restart();
    }
  }

  async #waitForProcessToSettle() {
    while (
      this.#ouinetStage == OuinetStages.Restarting ||
      this.#ouinetStage == OuinetStages.Exiting ||
      this.#ouinetStage == OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage == OuinetStages.StartingProcess
    ) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async #setValueInAPI(element_id, newValue) {
    const connectionId = this.#connectionId;
    while (
      connectionId === this.#connectionId && (
      this.#ouinetStage === OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage === OuinetStages.StartingProcess
    )) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (
      connectionId === this.#connectionId && (
      this.#ouinetStage == OuinetStages.Connected ||
      this.#ouinetStage == OuinetStages.Degraded
    )) {
      try {
        await this.#getFromOuinetFrontend(`${this.#endpoints.frontend_set_value}?${element_id}=${newValue ? 'enable' : 'disable'}`);
        this.#apiPollTimeoutResolver();
      } catch (e) {
          lazy.logger.error(`Failed to set ${element_id}=${newValue ? 'enable' : 'disable'} in Ouinet API`, e);
      }
    }
  }

  // Enabling/disabling proxy and configuring authentication is performed in the extension
  #extensionCallbacks = {
    onConnect: null,
    onConnectCalled: false,
    onDisconnect: null,
    onDisconnectCalled: false,
  }
  #extensionOnConnect() {
    if (
      this.#extensionCallbacks.onConnect !== null &&
      !this.#extensionCallbacks.onConnectCalled
    ) {
      this.#extensionCallbacks.onConnect(
        this.#endpoints.proxy,
        this.#credentials.proxy_user,
        this.#credentials.proxy_password
      );
      this.#extensionCallbacks.onConnectCalled = true;
    }
    this.#extensionCallbacks.onDisconnectCalled = false;
  }
  async RegisterExtensionOnConnectCallback(onConnectCallback) {
    this.#extensionCallbacks.onConnect = onConnectCallback;
    if (
      this.#ouinetStage === OuinetStages.Degraded ||
      this.#ouinetStage === OuinetStages.Connected
    ) {
      this.#extensionOnConnect();
    }
  }
  async UnregisterExtensionOnConnectCallback() {
    this.#extensionCallbacks.onConnect = null;
  }

  #extensionOnDisconnect() {
    if (
      this.#extensionCallbacks.onDisconnect !== null &&
      !this.#extensionCallbacks.onDisconnectCalled
    ) {
      this.#extensionCallbacks.onDisconnect();
      this.#extensionCallbacks.onDisconnectCalled = true;
    }
    this.#extensionCallbacks.onConnectCalled = false;
  }
  async RegisterExtensionOnDisconnectCallback(onDisconnectCallback) {
    this.#extensionCallbacks.onDisconnect = onDisconnectCallback;
    if (
      this.#ouinetStage !== OuinetStages.Degraded &&
      this.#ouinetStage !== OuinetStages.Connected
    ) {
      this.#extensionOnDisconnect();
    }
  }
  async UnregisterExtensionOnDisconnectCallback() {
    this.#extensionCallbacks.onDisconnect = null;
  }

  #executeWhenOuinetExits_ = [];
  #executeWhenOuinetExits(lambda) {
    if(
      this.#ouinetStage == OuinetStages.Init ||
      this.#ouinetStage == OuinetStages.Exited ||
      this.#ouinetStage == OuinetStages.Error
    ) {
      lambda();
    } else {
      this.#executeWhenOuinetExits_.push(lambda);
    }
  }
  #executeAfterOuinetExits_ = [];
  #executeAfterOuinetExits(lambda) {
    if(
      this.#ouinetStage == OuinetStages.Init ||
      this.#ouinetStage == OuinetStages.Exited ||
      this.#ouinetStage == OuinetStages.Error
    ) {
      lambda();
    } else {
      this.#executeAfterOuinetExits_.push(lambda);
    }
  }

  #onOuinetExit(connectionId, _exitCode) {
    for (const lambda of this.#executeWhenOuinetExits_) {
      try {
        lambda();
      } catch (e) {
        lazy.logger.error(e);
      }
    }
    this.#executeWhenOuinetExits_ = [];

    if (connectionId !== this.#connectionId) {
      lazy.logger.debug("Abandoning cancelled connection attempt");
      this.#executeAfterOuinetExits_ = [];
      return;
    }

    this.#ouinetProcess = null;
    this.#metricsRecordId = undefined;

    if (
      this.#ouinetStage === OuinetStages.StartingProcess ||
      this.#ouinetStage === OuinetStages.ConnectingToNetwork
    ) {
        if (Services.prefs.getStringPref(OuinetPrefs.logging_level) === "disabled") {
          this.#ouinetState.errors.failed_to_start_suggest_logging = true;
        } else {
          if (lazy.OuinetLauncherUtil.getOuinetFile("logfile", false).exists())
            this.#ouinetState.errors.failed_to_start_show_log = true;
          else
            this.#ouinetState.errors.failed_to_start = true;
        }
        this.#setOuinetStage(OuinetStages.Error, false);
    }
    if (this.#ouinetStage === OuinetStages.Restarting) {
      this.#ouinetStage = OuinetStages.Exited;
      this.connect();
    }
    else if (
      this.#ouinetStage !== OuinetStages.Exited &&
      this.#ouinetStage !== OuinetStages.Restarting &&
      this.#ouinetStage !== OuinetStages.Error
    ) {
      this.#setOuinetStage(OuinetStages.Init, false);
    }

    if (this.#ouinetStage !== OuinetStages.Error) {
      this.#initOuinetState();
    }

    for (const lambda of this.#executeAfterOuinetExits_) {
      try {
        lambda();
      } catch (e) {
        lazy.logger.error(e);
      }
    }
    this.#executeAfterOuinetExits_ = [];

    this.#sendNotifications();
  }

  async connect() {
    lazy.logger.debug("CenoNetwork.connect()");
    if (
      this.#ouinetStage !== OuinetStages.Init &&
      this.#ouinetStage !== OuinetStages.Exited &&
      this.#ouinetStage !== OuinetStages.Restarting &&
      this.#ouinetStage !== OuinetStages.Error
    ) {
      lazy.logger.warn("Ignoring double connect request", this.#ouinetStage);
      return;
    }

    this.#initOuinetState();
    this.#setOuinetStage(OuinetStages.StartingProcess, true);
    // Current connection can be stopped and restarted during await in the middle of this async function,
    // Not enough to evaluate #ouinetStage alone.
    // need to know if we are still in the same connection.
    const connectionId = Number(++this.#connectionId);

    this.#credentials.proxy_password = randomString(16);
    this.#credentials.frontend_token = randomString(16);
    this.#storeSecret(this.#credentials.proxy_user, this.#credentials.proxy_password, Secrets.proxy_realm);
    this.#storeSecret(this.#credentials.proxy_user, this.#credentials.frontend_token, Secrets.frontend_realm);

    this.#ouinetProcess = new lazy.OuinetProcess((exitCode) => { this.#onOuinetExit(connectionId, exitCode); });

    await this.#ouinetProcess.start(this.#credentials, this.#ouinetState);

    // Connection could be cancelled or restarted during the previous `await`.
    // Do the check after each await
    if (
      connectionId !== this.#connectionId ||
      this.#ouinetStage !== OuinetStages.StartingProcess
    ) {
      lazy.logger.debug("Abandoning cancelled connection attempt");
      return;
    }

    this.#setOuinetStage(OuinetStages.ConnectingToNetwork, true);

    this.#installCaCert(connectionId);

    const delayBetweenAttempts = 1000;
    while (
      connectionId === this.#connectionId &&
      this.#ouinetStage === OuinetStages.ConnectingToNetwork
    ) {
      if (await this.#getApiEndpoints()) {
        this.#pollApiStatus(connectionId);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts));
    }
  }

  async #installCaCert(connectionId) {
    const cacert = lazy.OuinetLauncherUtil.getOuinetFile("cacert", false);
    const delayBetweenAttempts = 1000;
    while (connectionId === this.#connectionId) {
      if (cacert.exists()) {
        lazy.OuinetLauncherUtil.setRootCertificate();
        break;
      } else {
        await new Promise(resolve => setTimeout(() => resolve(), delayBetweenAttempts));
      }
    }
  }

  cancel() {
    lazy.logger.debug("CenoNetwork.cancel() previous stage:", this.#ouinetStage);
    const connectionId = this.#connectionId;
    if (null !== this.#ouinetProcess) {
      this.#setOuinetStage(OuinetStages.Exiting);
      this.#ouinetProcess.stop();
      const doubleTapTimeout = 5000;
      new Promise(resolve => setTimeout(() => {
        if (
          connectionId === this.#connectionId &&
          this.#ouinetStage === OuinetStages.Exiting
        ){
          this.#ouinetProcess.stop();
        }
        resolve();
      }, doubleTapTimeout));
    } else {
      lazy.logger.warn("No connection to cancel");
    }
    this.#sendNotifications();
  }

  #restart() {
    const connectionId = this.#connectionId;
    if (null !== this.#ouinetProcess) {
      this.#setOuinetStage(OuinetStages.Restarting);
      this.#ouinetProcess.stop();
      const doubleTapTimeout = 500;
      new Promise(resolve => setTimeout(() => {
        if (
          connectionId === this.#connectionId &&
          this.#ouinetStage === OuinetStages.Restarting
        ){
          this.#ouinetProcess.stop();
        }
        resolve();
      }, doubleTapTimeout));
    } else {
      lazy.logger.warn("No connection to cancel");
    }
    this.#sendNotifications();
  }

  async purgeOuinetCache() {
    lazy.logger.debug("Purging Ouinet cache");

    await this.#waitForProcessToSettle();
    if (
      this.#ouinetStage == OuinetStages.Connected ||
      this.#ouinetStage == OuinetStages.Degraded
    ) {
      await this.#getFromOuinetFrontend(`${this.#endpoints.frontend_set_value}?purge_cache=do`);
      this.#apiPollTimeoutResolver();
    }
  }

  async newIdentity() {
    await this.#waitForProcessToSettle();

    if (
      this.#ouinetStage == OuinetStages.Connected ||
      this.#ouinetStage == OuinetStages.Degraded
    ) {
      this.#extensionOnDisconnect();
      await this.#getFromOuinetFrontend(`${this.#endpoints.frontend_set_value}?purge_cache=do`);
      this.#extensionOnConnect();
    } else {
      try {
        const bep5_http = lazy.OuinetLauncherUtil.getOuinetFile("bep5_http");
        if (bep5_http.exists()) {
          bep5_http.remove(true);
        }
      } catch (e) { lazy.logger.error("Failed to remove bep5_http dir:", e); }
      try {
        const logfile = lazy.OuinetLauncherUtil.getOuinetFile("logfile", false);
        if (logfile.exists()) {
          logfile.remove(false);
          this.#sendNotifications();
        }
      } catch (e) { lazy.logger.error("Failed to remove logfile:", e)}
    }
  }

  async observe(_subject, topic, data) {
    if (topic === NETWORK_LINK_TOPIC) {
      this.#updateInternetStatus();
      return;
    }

    if (topic === "nsPref:changed") {
      const fullPrefName = "ceno.network." + data;
      switch (fullPrefName) {
        case OuinetPrefs.origin_access:
        case OuinetPrefs.proxy_access:
        case OuinetPrefs.injector_access:
        case OuinetPrefs.distributed_cache:
          this.#setValueInAPI(data, Services.prefs.getBoolPref(fullPrefName) ? 'enable' : 'disable');
          this.#ouinetState.personal_unreachable = !Services.prefs.getBoolPref(OuinetPrefs.origin_access) && !Services.prefs.getBoolPref(OuinetPrefs.proxy_access);
          this.#ouinetState.public_unreachable = !Services.prefs.getBoolPref(OuinetPrefs.origin_access) && !Services.prefs.getBoolPref(OuinetPrefs.injector_access) && !Services.prefs.getBoolPref(OuinetPrefs.distributed_cache);
          this.#sendNotifications();
          break;

        case OuinetPrefs.logging_level:
          const logging_level = Services.prefs.getStringPref(OuinetPrefs.logging_level);
          if (logging_level === "disabled") {
            const removeLogfile = () => {
              if (Services.prefs.getStringPref(OuinetPrefs.logging_level) === "disabled") {
                try {
                  const logfile = lazy.OuinetLauncherUtil.getOuinetFile("logfile", false);
                  if (logfile.exists()) {
                    logfile.remove(false);
                    this.#sendNotifications();
                  }
                } catch (e) {
                  lazy.logger.error("Failed to remove log file: ", e);
                }
              }
            };
            this.#executeWhenOuinetExits(removeLogfile);
            await this.#setValueInAPI("logfile", "disable");
          } else if (!["silly", "debug", "verbose", "info", "warn", "error", "abort", "disabled"].includes(logging_level)) {
            Services.prefs.setStringPref(OuinetPrefs.logging_level, "disabled");
          } else {
            this.#restartIfRunning();
          }
          break;

        case OuinetPrefs.udp_mux_port:
        case OuinetPrefs.udp_mux_port_random: {
          const removeLastUsedPort = () => {
            try {
              const lastUsedPort = lazy.OuinetLauncherUtil.getOuinetFile("last_used_udp_port", false);
              if (lastUsedPort.exists()) {
                lastUsedPort.remove(false);
              }
            } catch (e) {
              lazy.logger.error("Failed to remove last_used_udp_port file: ", e);
            }
          };
          this.#executeWhenOuinetExits(removeLastUsedPort);
          break;
        }
      }

      const restartablePrefs = [
        OuinetPrefs.doh,
        OuinetPrefs.bridge,
        OuinetPrefs.udp_mux_port,
        OuinetPrefs.udp_mux_port_random,
      ];
      if (restartablePrefs.includes(fullPrefName)) {
        this.#restartIfRunning();
      } else {
      }
    } else if (topic === "firewall-modified") {
        lazy.logger.debug(`Firewall status: ${data}`);
        // List of firewall status strings defined in toolkit\components\ouinet-native-helpers\Firewall.cpp
        switch (data) {
          case "Blocked":
          case "BlockedByDefault":
            this.#ouinetState.blocked_by_firewall = true;
            if (this.#ouinetState.connection_was_made) {
              this.#ouinetState.errors.firewall = true;
            }
            break;

          // case "Allowed":
          // case "AllowedByDefault":
          // case "FirewallDisabled":
          default:
            this.#ouinetState.blocked_by_firewall = false;
            this.#ouinetState.errors.firewall = false;
            break;
        }
        this.#sendNotifications();
    }
  }

  showLogFile() {
    Services.wm.getMostRecentWindow("navigator:browser").gBrowser.addTab(
      "file://" + lazy.OuinetLauncherUtil.getOuinetFile("logfile", false).path,
      {
        inBackground: false,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      }
    );
  }

  enableLoggingAndConnect() {
    // @TODO: this triggers a restart because observe() runs this.#restartIfRunning()
    Services.prefs.setStringPref(OuinetPrefs.logging_level, "info");
    return CenoNetwork.connect();
  }

  allowFirewall() {
    const portToAllow = this.#ouinetState.udp_mux_port_random ? 0 : this.#ouinetState.udp_mux_port_actual;
    lazy.logger.debug('Attempting to add firewall rule for UDP port', portToAllow);
    const options = {
      command: lazy.OuinetLauncherUtil.getOuinetFile("client-firewall-allow", false).path,
      arguments: [String(portToAllow)],
      stdin: 'devnull',
      stdout: 'devnull',
      stderr: 'devnull',
      workdir: lazy.OuinetLauncherUtil.getOuinetFile("startup-dir", false).path,
    };
    lazy.Subprocess.call(options)
      .then(subprocess => subprocess.wait())
      .then(({ exitCode }) => {
        if (exitCode !== 0) {
          throw new Error(`exit code ${exitCode}`);
        }
        lazy.logger.debug('Firewall rules addedd successfully');
      }).catch (error => {
        lazy.logger.error("Failed to add firewall rules:", error);
      })
  }

  async #loadOuinetCredentials() {
    const logins = await Services.logins.searchLoginsAsync({ origin: Secrets.origin });
    for (const login of logins) {
      if (login.httpRealm === Secrets.proxy_realm) {
        this.#credentials.proxy_password = login.password;
        if (this.#credentials.frontend_token !== null) {
          return;
        }
      } else if (login.httpRealm === Secrets.frontend_realm) {
        this.#credentials.frontend_token = login.password;
        if (this.#credentials.proxy_password !== null) {
          return;
        }
      }
    }
  }

  #storeSecret(username, password, realm) {
    const origin = Secrets.origin;
    const connectionId = this.#connectionId;

    const login = new Components.Constructor(
      "@mozilla.org/login-manager/loginInfo;1",
      Ci.nsILoginInfo,
      "init"
    )(origin, null, realm, username, password, "", "");

    return Services.logins.searchLoginsAsync({ origin: origin, httpRealm: realm }).then(logins => {
      if (connectionId !== this.#connectionId) {
        return;
      }

      // Filter by realm since multiple entries can share the same origin
      const existing = logins.find(l => l.httpRealm === realm);
      if (existing) {
        Services.logins.modifyLogin(existing, login);
      } else {
        return Services.logins.addLoginAsync(login);
      }
    });
  }
};

export const CenoNetwork = new _CenoNetwork();
