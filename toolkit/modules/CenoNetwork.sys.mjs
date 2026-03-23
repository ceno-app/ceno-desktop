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
});

ChromeUtils.defineLazyGetter(lazy, "NetworkLinkService", () => {
  // NetworkLinkService is unavailable on some platforms like openBSD.
  // See tor-browser#43628.
  return Cc["@mozilla.org/network/network-link-service;1"]?.getService(
    Ci.nsINetworkLinkService
  );
});

const NETWORK_LINK_TOPIC = "network:link-status-changed";

const CenoNetworkPrefs = Object.freeze({
  log_level: "ceno.network.log_level",
  quickstart: "ceno.network.quickstart",

  headless: "ceno.network.headless",

  proxy_password: "ceno.network.proxy_password",
  frontend_token: "ceno.network.frontend_token",
});

const OuinetPrefs = Object.freeze({
  origin_access: "ceno.network.origin_access",
  proxy_access: "ceno.network.proxy_access",
  injector_access: "ceno.network.injector_access",
  distributed_cache: "ceno.network.distributed_cache",
  logging: "ceno.network.logging",
  logging_level: "ceno.network.logging_level",
  metrics: "ceno.network.metrics",
  doh: "ceno.network.doh",
  unencrypted_dns: "ceno.network.unencrypted_dns",
  bridge: "ceno.network.bridge",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () =>
  console.createInstance({
    maxLogLevelPref: CenoNetworkPrefs.log_level,
    prefix: "CenoNetwork",
  })
);

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
  SetQuickstart: "cenonetwork:set-quickstart",
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

  #quickstart = Services.prefs.getBoolPref(CenoNetworkPrefs.quickstart, false);
  #headless = Services.prefs.getBoolPref(CenoNetworkPrefs.headless, false);

  #ouinetProcess = null;

  #connectionId = 0;

  #credentials = {
    proxy_user: 'user',
    proxy_password: Services.prefs.getStringPref(CenoNetworkPrefs.proxy_password, null),
    frontend_token: Services.prefs.getStringPref(CenoNetworkPrefs.frontend_token, null),
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
    this.#ouinetState.origin_access = Services.prefs.getBoolPref(OuinetPrefs.origin_access, true);
    this.#ouinetState.proxy_access = Services.prefs.getBoolPref(OuinetPrefs.proxy_access, true);
    this.#ouinetState.injector_access = Services.prefs.getBoolPref(OuinetPrefs.injector_access, true);
    this.#ouinetState.distributed_cache = Services.prefs.getBoolPref(OuinetPrefs.distributed_cache, true);

    this.#ouinetState.local_cache_size = undefined;
    this.#ouinetState.logging = Services.prefs.getBoolPref(OuinetPrefs.logging, false);
    this.#ouinetState.logging_level = Services.prefs.getStringPref(OuinetPrefs.logging_level, "error");
    this.#ouinetState.metrics = Services.prefs.getBoolPref(OuinetPrefs.metrics, true);
    this.#ouinetState.doh = Services.prefs.getBoolPref(OuinetPrefs.doh, this.#metricsRegion[1] != "R" || this.#metricsRegion[0] != "I");
    this.#ouinetState.unencrypted_dns = this.#ouinetState.doh ? Services.prefs.getBoolPref(OuinetPrefs.unencrypted_dns, true) : true;
    this.#ouinetState.bridge = Services.prefs.getBoolPref(OuinetPrefs.bridge, true);

    this.#ouinetState.reachability = undefined;
    this.#ouinetState.upnp = undefined;
    this.#ouinetState.local_udp = undefined;
    this.#ouinetState.public_udp = undefined;

    this.#ouinetState.errors.failed_to_start = false;
    this.#ouinetState.errors.failed_to_start_show_log = false;
    this.#ouinetState.errors.failed_to_start_suggest_logging = false;
  }

  CenoNetworkState() {
    let res = structuredClone(this.#ouinetState);
    res['ouinetStage'] = this.#ouinetStage;
    res['internetStatus'] = this.#internetStatus;
    res['quickstart'] = this.#quickstart;
    res['headless'] = this.#headless;
    const logfile = lazy.OuinetLauncherUtil.getOuinetFile("logfile", false);
    res['logfile'] = res['logging'] && logfile.exists() ? lazy.OuinetLauncherUtil.getOuinetFile("logfile", false).path : false;
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

  setQuickstart(isEnabled) {
    isEnabled = Boolean(isEnabled);
    this.#quickstart = isEnabled;
    Services.prefs.setBoolPref(CenoNetworkPrefs.quickstart, isEnabled);
    this.#sendNotifications();
  }

  setHeadless(isEnabled) {
    isEnabled = Boolean(isEnabled);
    this.#headless = isEnabled;
    Services.prefs.setBoolPref(CenoNetworkPrefs.headless, isEnabled);
    this.#sendNotifications();
  }

  // init is called by OuinetStartupService
  async init() {
    this.#initOuinetState();
    Services.obs.addObserver(this, NETWORK_LINK_TOPIC);
    await this.#updateInternetStatus();

    try {
      const firewallUpdate = (firewallStatus) => {
        lazy.logger.info(`Firewall status: ${firewallStatus}`);
        // List of firewall status strings defined in toolkit\components\ouinet-native-helpers\Firewall.cpp
        switch (firewallStatus) {
          case "Blocked":
          case "BlockedByDefault":
            this.#ouinetState.blocked_by_firewall = true;
            if (this.#ouinetState.connection_was_made) {
              this.#ouinetState.errors.firewall = true;
            }
            break;
          default:
          // case "Allowed":
          // case "AllowedByDefault":
          // case "FirewallDisabled":
            {
              this.#ouinetState.blocked_by_firewall = false;
              this.#ouinetState.errors.firewall = false;
            }
            break;
        }
        this.#sendNotifications();
      };
      const firewallObserver = {
        QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
        observe: function(_subject, _topic, firewallStatus) {
          firewallUpdate(firewallStatus);
        }
      };
      Services.OuinetNativeHelpers.MonitorFirewall(
        lazy.OuinetLauncherUtil.getOuinetFile("client", false).path,
        firewallObserver
      );
    } catch (e) {
      lazy.logger.error(e);
    }

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
        if (this.#quickstart) {
          this.#onOuinetExit_post = () => {
            lazy.logger.debug('Quickstart enabled');
            this.connect();
          }
        }
      }
    } else if (this.#quickstart) {
      lazy.logger.debug('Quickstart enabled');
      this.connect();
    }
  }

  uninit() {
    Services.obs.removeObserver(this, NETWORK_LINK_TOPIC);
    if (!this.#headless) {
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

        this.#ouinetState.origin_access = json.origin_access;
        this.#ouinetState.proxy_access = json.proxy_access;
        this.#ouinetState.injector_access = json.injector_access;
        this.#ouinetState.distributed_cache = json.distributed_cache;
        this.#ouinetState.logging = json.logfile;
        this.#ouinetState.metrics = json.metrics_enabled;
        this.#ouinetState.doh = json.dns_protocols.includes("https");
        this.#ouinetState.unencrypted_dns = json.dns_protocols.includes("plain");
        this.#ouinetState.bridge = json.bridge_announcement;

        this.#ouinetState.local_cache_size = json.local_cache_size;
        this.#ouinetState.reachability = json.udp_world_reachable;
        this.#ouinetState.upnp = json.is_upnp_active;
        this.#ouinetState.local_udp = json.local_udp_endpoints.join(', ');
        this.#ouinetState.public_udp = json.public_udp_endpoints.join(', ');

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

  #restartIfRunning() {
    if (
      this.#ouinetStage == OuinetStages.Connected ||
      this.#ouinetStage == OuinetStages.Degraded
    ) {
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

  // @TODO: this could be simplified somehow
  // it got a bit ugly over time
  async setOuinetConfigValue(element_id, newValue) {
    const connectionId = this.#connectionId;
    if (element_id === "logging_level") {
      if (!["silly", "debug", "verbose", "info", "warn", "error", "abort"].includes(newValue)) {
        lazy.logger.error("Bad logging_level value: ", newValue);
        return;
      }
      this.#ouinetState["logging_level"] = newValue;
      Services.prefs.setStringPref(OuinetPrefs.logging_level, newValue);
      await this.#waitForProcessToSettle();
      if (connectionId === this.#connectionId) {
        this.#restartIfRunning();
      }
      return;
    }

    lazy.logger.info(`Attempting to set ${element_id}=${newValue ? 'enable' : 'disable'}`);

    if (element_id in OuinetPrefs) {
      Services.prefs.setBoolPref(OuinetPrefs[element_id], newValue);
      this.#ouinetState[element_id] = newValue;

      if (element_id === "doh" && !newValue && !this.#ouinetState["unencrypted_dns"]) {
        this.#ouinetState["unencrypted_dns"] = true;
      }

      this.#sendNotifications();
    }

    await this.#waitForProcessToSettle();
    if (connectionId != this.#connectionId) {
      return;
    }

    if (element_id === "doh" || element_id === "unencrypted_dns" || element_id === "bridge") {
      this.#restartIfRunning();
      return;
    }

    if (element_id == "logging" && !this.#ouinetState.logging) {
      if(
        this.#ouinetStage == OuinetStages.Init ||
        this.#ouinetStage == OuinetStages.Exited ||
        this.#ouinetStage == OuinetStages.Error
      ) {
        try {
          lazy.OuinetLauncherUtil.getOuinetFile("logfile", false).remove(false);
        } catch (e) {
          lazy.logger.error("Failed to remove log file: ", e);
        }
      } else {
        this.#onOuinetExit_pre = () => {
          // Make sure that logging was not toggled back on before removing the log file
          if (!this.#ouinetState.logging) {
            try {
              lazy.OuinetLauncherUtil.getOuinetFile("logfile", false).remove(false);
              if (this.#ouinetState.errors.failed_to_start_show_log) {
                this.#ouinetState.errors.failed_to_start_show_log = false;
                this.#ouinetState.errors.failed_to_start = true;
              }
            } catch (e) {
              lazy.logger.error("Failed to remove log file: ", e);
            }
          }
        }
      }
    }

    if (
      this.#ouinetStage == OuinetStages.Connected ||
      this.#ouinetStage == OuinetStages.Degraded
    ) {
      // logging in ouinet is referred to as logfile
      if (element_id == "logging") {
        element_id = "logfile"
      }
      await this.#setValueInAPI(element_id, newValue);
    }
  }

  async #setValueInAPI(element_id, newValue) {
    try {
      await this.#getFromOuinetFrontend(`${this.#endpoints.frontend_set_value}?${element_id}=${newValue ? 'enable' : 'disable'}`);
      this.#apiPollTimeoutResolver();
    } catch (e) {
        lazy.logger.error(`Failed to set ${element_id}=${newValue ? 'enable' : 'disable'} in Ouinet API`, e);
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

  #onOuinetExit_pre = () => {};
  #onOuinetExit_post = () => {};
  #onOuinetExit(connectionId, exitCode) {
    this.#onOuinetExit_pre();
    this.#onOuinetExit_pre = () => {};
    if (connectionId !== this.#connectionId) {
      lazy.logger.debug("Abandoning cancelled connection attempt");
      return;
    }

    this.#ouinetProcess = null;
    this.#metricsRecordId = undefined;

    if (
      this.#ouinetStage === OuinetStages.StartingProcess ||
      this.#ouinetStage === OuinetStages.ConnectingToNetwork
    ) {
        if (this.#ouinetState.logging) {
          if (lazy.OuinetLauncherUtil.getOuinetFile("logfile", false).exists())
            this.#ouinetState.errors.failed_to_start_show_log = true;
          else
            this.#ouinetState.errors.failed_to_start = true;
        } else {
          this.#ouinetState.errors.failed_to_start_suggest_logging = true;
        }
        this.#setOuinetStage(OuinetStages.Error, false);
    }
    else if (
      this.#ouinetStage !== OuinetStages.Exited &&
      this.#ouinetStage !== OuinetStages.Restarting
    ) {
      this.#setOuinetStage(OuinetStages.Init, false);
    }

    if (this.#ouinetStage !== OuinetStages.Error) {
      this.#initOuinetState();
    }

    this.#onOuinetExit_post();
    this.#onOuinetExit_post = () => {};

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

    this.#setOuinetStage(OuinetStages.StartingProcess, true);
    // Current connection can be stopped and restarted during await in the middle of this async function,
    // Not enough to evaluate #ouinetStage alone.
    // need to know if we are still in the same connection.
    const connectionId = Number(++this.#connectionId);

    this.#credentials.frontend_token = randomString(16);
    this.#credentials.proxy_password = randomString(16);
    Services.prefs.setStringPref(CenoNetworkPrefs.frontend_token, this.#credentials.frontend_token);
    Services.prefs.setStringPref(CenoNetworkPrefs.proxy_password, this.#credentials.proxy_password);

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
    lazy.logger.debug("CenoNetwork.cancel() ", this.#ouinetStage);
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
      this.#onOuinetExit_post = () => {
        if (
          connectionId === this.#connectionId &&
          this.#ouinetStage === OuinetStages.Restarting
        ) {
          this.connect();
        }
      }
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
      const bep5_http = lazy.OuinetLauncherUtil.getOuinetFile("bep5_http");
      if (bep5_http.exists()) {
        bep5_http.remove(true);
      }
    }
  }

  async observe(_subject, topic) {
    switch (topic) {
      case NETWORK_LINK_TOPIC:
        this.#updateInternetStatus();
        break;
    }
  }

  showLogFile() {
    lazy.logger.error("showLogFile");
    Services.wm.getMostRecentWindow("navigator:browser").gBrowser.addTab(
      "file://" + lazy.OuinetLauncherUtil.getOuinetFile("logfile", false).path,
      {
        inBackground: false,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      }
    );
  }

  enableLoggingAndReconnect() {
    this.#ouinetState.logging = true;
    Services.prefs.setBoolPref(OuinetPrefs.logging, true);
    this.connect();
  }
};

export const CenoNetwork = new _CenoNetwork();
