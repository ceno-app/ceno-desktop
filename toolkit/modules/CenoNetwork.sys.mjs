import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { AsyncSocket } from "resource://gre/modules/AsyncSocket.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  MissingDataDirError: "resource://gre/modules/OuinetProcess.sys.mjs",
  MissingOuinetBinaryError: "resource://gre/modules/OuinetProcess.sys.mjs",
  OuinetStartupError: "resource://gre/modules/OuinetProcess.sys.mjs",
  OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
  OuinetProcess: "resource://gre/modules/OuinetProcess.sys.mjs",
  OuinetProcessMonitor: "resource://gre/modules/OuinetProcessMonitor.sys.mjs",
  OuinetProcessTerminator: "resource://gre/modules/OuinetProcessTerminator.sys.mjs",
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
  metrics: "ceno.network.metrics",
  doh: "ceno.network.doh",
  bridge: "ceno.network.bridge",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () =>
  console.createInstance({
    maxLogLevelPref: CenoNetworkPrefs.log_level,
    prefix: "CenoNetwork",
  })
);

// Keep CenoNetworkErrors in sync with aboutCenoHome.js
export const CenoNetworkErrors = Object.freeze({
  FailedToStart: "FailedToStart",
  FailedToStartSuggestLogging: "FailedToStartSuggestLogging",
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

// Keep OuinetStages in sync with aboutCenoHome.js
export const OuinetStages = Object.freeze({
  Init: "Init",
  StartingProcess: "StartingProcess",
  ConnectingToNetwork: "ConnectingToNetwork",
  Connected: "Connected",
  Degraded: "Degraded",
  Exited: "Exited",
  Error: "Error",
});

export function ouinetStageToL10n(state) {
  switch (state) {
    case OuinetStages.Connected:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-connected";

    case OuinetStages.Degraded:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-degraded";

    case OuinetStages.Init:
    case OuinetStages.Exited:
    default:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-not-connected";

    case OuinetStages.StartingProcess:
    case OuinetStages.ConnectingToNetwork:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-connecting";

    case OuinetStages.Error:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-error";
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
  #error = null;
  #quickstart = Services.prefs.getBoolPref(CenoNetworkPrefs.quickstart, false);
  #headless = Services.prefs.getBoolPref(CenoNetworkPrefs.headless, false);

  #ouinetProcess = null;
  #ouinetProcessMonitor = null;

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

  #ouinetState = {
    origin_access: Services.prefs.getBoolPref(OuinetPrefs.origin_access, true),
    proxy_access: Services.prefs.getBoolPref(OuinetPrefs.proxy_access, true),
    injector_access: Services.prefs.getBoolPref(OuinetPrefs.injector_access, true),
    distributed_cache: Services.prefs.getBoolPref(OuinetPrefs.distributed_cache, true),

    local_cache_size: undefined,
    logging: Services.prefs.getBoolPref(OuinetPrefs.logging, true),
    metrics: Services.prefs.getBoolPref(OuinetPrefs.metrics, true),
    doh: Services.prefs.getBoolPref(OuinetPrefs.doh, true),
    bridge: Services.prefs.getBoolPref(OuinetPrefs.bridge, true),

    reachability: undefined,
    upnp: undefined,
    local_udp: undefined,
    public_udp: undefined,
  }

  #metricsRegion = Services.MetricsGeoTimezone.region;
  #metricsTimezone = Services.MetricsGeoTimezone.timezone;
  #metricsRecordId = undefined;

  CenoNetworkState() {
    let res = structuredClone(this.#ouinetState);
    res['ouinetStage'] = this.#ouinetStage;
    res['internetStatus'] = this.#internetStatus;
    res['error'] = this.#error
    res['quickstart'] = this.#quickstart;
    res['headless'] = this.#headless;

    const logFile = lazy.OuinetLauncherUtil.getOuinetFile("logfile", false);
    res['logfile'] = logFile.exists() ? logFile.path : undefined;

    return res;
  }

  #sendNotifications() {
    lazy.logger.debug("Sending notifications", this.#ouinetStage, this.#ouinetState);
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

  #updateInternetStatus() {
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
    this.#error = null;
    this.#ouinetStage = newStageName;
    if (sendNotifications) {
      this.#sendNotifications();
    }
  }

  #setError(errorName) {
    this.#ouinetStage = OuinetStages.Error;
    this.#error = errorName;
    this.#sendNotifications();
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
    Services.obs.addObserver(this, NETWORK_LINK_TOPIC);
    this.#updateInternetStatus();

    const pidFile = lazy.OuinetLauncherUtil.getOuinetFile("client-pid-file", false)
    if (pidFile.exists()) {
      lazy.logger.debug('Process id file found, trying to inherit previous Ceno Network Connection');
      const connectionId = Number(++this.#connectionId);
      if (await this.#getApiEndpoints()) {
        if (connectionId !== this.#connectionId) {
          lazy.logger.debug("Abandoning cancelled connection attempt");
          return;
        }
        lazy.logger.info('Endpoints found, inheriting previous Ceno Network Connection');
        this.#setOuinetStage(OuinetStages.ConnectingToNetwork, true);

        this.#ouinetProcessMonitor = new lazy.OuinetProcessMonitor();
        this.#ouinetProcessMonitor.monitor().then(_exitCode => {
          if (connectionId !== this.#connectionId) {
            lazy.logger.debug("Abandoning cancelled connection attempt");
            return;
          }
          this.#ouinetProcessMonitor = null;
          if (this.#ouinetStage !== OuinetStages.Exited) {
            this.#setOuinetStage(OuinetStages.Init, true);
          }
          this.#sendNotifications();
        });

        this.#pollApiStatus(connectionId);
      } else {
        lazy.logger.debug('Endpoints unavailable, cannot inherit previous Ceno Network Connection. Terminating previous process');
        await new lazy.OuinetProcessTerminator().terminate();
        if (this.#quickstart) {
          lazy.logger.debug('Quickstart enabled');
          this.connect();
        }
      }
    } else if (this.#quickstart) {
      lazy.logger.debug('Quickstart enabled');
      this.connect();
    }
  }

  uninit() {
    Services.obs.removeObserver(this, NETWORK_LINK_TOPIC);

    if (this.#headless) {
      if (this.#ouinetProcessMonitor) {
        this.#ouinetProcessMonitor.cancel();
        this.#ouinetProcessMonitor = null;
      }
    } else {
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
      this.#ouinetStage === OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage === OuinetStages.Degraded ||
      this.#ouinetStage === OuinetStages.Connected
    ) {
      if (connectionId !== this.#connectionId) {
        lazy.logger.debug("Abandoning cancelled connection attempt");
        return;
      }

      try {
        const response = await this.#getFromOuinetFrontend(this.#endpoints.frontend_get_api_status);
        const json = await response.json();
        if (connectionId !== this.#connectionId) {
          lazy.logger.debug("Abandoning cancelled connection attempt");
          return;
        }

        this.#ouinetState.origin_access = json.origin_access;
        this.#ouinetState.proxy_access = json.proxy_access;
        this.#ouinetState.injector_access = json.injector_access;
        this.#ouinetState.distributed_cache = json.distributed_cache;
        this.#ouinetState.logging = json.logfile;
        this.#ouinetState.metrics = json.metrics_enabled;
        this.#ouinetState.doh = json.doh_enabled;
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
          await this.#sendMetrics('APP_VERSION', lazy.AppConstants.BASE_BROWSER_VERSION);
          await this.#sendMetrics('NETWORK_COUNTRY', this.#metricsRegion);
          await this.#sendMetrics('NETWORK_COUNTRY_CONFIDENCE', "1");
          await this.#sendMetrics('TIMEZONE', this.#metricsTimezone);
          await this.#sendMetrics('BRIDGE_OPT_IN', this.#ouinetState.bridge ? "true" : "false");
        }
      } catch (e) {
        lazy.logger.error('Failed to get ouinet API status', e);
        break;
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
    try {
      lazy.logger.debug(`Sending metrics '${key}'='${value}'`);
      await this.#getFromOuinetFrontend(`${this.#endpoints.frontend_metrics_set_key}?record_id=${this.#metricsRecordId}&key=${key}&value=${value}`);
    } catch (e) {
      lazy.logger.error('Failed to send metrics', e);
    }
  }

  async setOuinetConfigValue(element_id, newValue) {
    lazy.logger.info(`Attempting to set ${element_id}=${newValue ? 'enable' : 'disable'}`);
    if (element_id in OuinetPrefs) {
      Services.prefs.setBoolPref(OuinetPrefs[element_id], newValue);
      this.#ouinetState[element_id] = newValue;
    }

    while (
      this.#ouinetStage == OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage == OuinetStages.StartingProcess
    ) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (element_id === "doh" || element_id === "bridge") {
      if (
        this.#ouinetStage == OuinetStages.Connected ||
        this.#ouinetStage == OuinetStages.Degraded ||
        this.#ouinetStage == OuinetStages.ConnectingToNetwork ||
        this.#ouinetStage == OuinetStages.StartingProcess
      ) {
        await this.cancel();
        await this.connect();
      }
      return;
    }

    while (
      this.#ouinetStage == OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage == OuinetStages.StartingProcess
    ) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (
      this.#ouinetStage == OuinetStages.Connected ||
      this.#ouinetStage == OuinetStages.Degraded
    ) {
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

  async connect() {
    lazy.logger.debug("CenoNetwork.connect()");
    if (
      this.#ouinetStage !== OuinetStages.Init &&
      this.#ouinetStage !== OuinetStages.Exited &&
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

    this.#ouinetProcess = new lazy.OuinetProcess();
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

    // Let ouinet client start before attempting to communicate with it
    lazy.logger.debug("Process started. Waiting for process to settle");
    await new Promise(resolve => setTimeout(() => resolve(), 100));

    const cacert = lazy.OuinetLauncherUtil.getOuinetFile("cacert", false);
    for (let i = 0; i < 100 && !cacert.exists(); ++i) {
      lazy.logger.debug('Waiting for cacert to be available', cacert.path);
      await new Promise(resolve => setTimeout(() => resolve(), 100));
    }
    lazy.OuinetLauncherUtil.setRootCertificate();

    const maxAttempts = 5;
    const delayBetweenAttempts = 1000;
    let didGetApiEndpoints = false;

    for (let i = 0; i < maxAttempts; i++) {
      if (
        connectionId !== this.#connectionId ||
        this.#ouinetStage !== OuinetStages.ConnectingToNetwork
      ) {
        lazy.logger.debug("Abandoning cancelled connection attempt");
        return;
      }

      didGetApiEndpoints = await this.#getApiEndpoints();
      if (didGetApiEndpoints) {
        break;
      } else if (i + 1 < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts));
      }
    }

    if (
      connectionId !== this.#connectionId ||
      this.#ouinetStage !== OuinetStages.ConnectingToNetwork
    ) {
      lazy.logger.debug("Abandoning cancelled connection attempt");
      return;
    }

    if (!didGetApiEndpoints) {
      await this.cancel();
      if (this.#ouinetState.logging) {
        this.#setError(CenoNetworkErrors.FailedToStart);
      } else {
        this.#setError(CenoNetworkErrors.FailedToStartSuggestLogging);
      }
      return;
    }

    this.#ouinetProcessMonitor = new lazy.OuinetProcessMonitor();
    this.#ouinetProcessMonitor.monitor().then(_exitCode => {
      if (connectionId !== this.#connectionId) {
        lazy.logger.debug("Abandoning cancelled connection attempt");
        return;
      }
      this.#ouinetProcessMonitor = null;
      if (this.#ouinetStage !== OuinetStages.Exited) {
        this.#setOuinetStage(OuinetStages.Init, true);
      }
      this.#sendNotifications();
    });
    this.#ouinetProcess = null;

    this.#pollApiStatus(connectionId);
  }

  async cancel() {
    lazy.logger.debug("CenoNetwork.cancel() ", this.#ouinetStage);
    if (
      this.#ouinetStage === OuinetStages.StartingProcess ||
      this.#ouinetStage === OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage === OuinetStages.Degraded ||
      this.#ouinetStage === OuinetStages.Connected
    ) {
      if (this.#ouinetProcess !== null) {
        this.#ouinetProcess.stop();
        this.#ouinetProcess = null;
      }
      await new lazy.OuinetProcessTerminator().terminate();
      if (null !== this.#ouinetProcessMonitor) {
        this.#ouinetProcessMonitor.cancel();
      }
      this.#setOuinetStage(OuinetStages.Exited, false);
      this.#metricsRecordId = undefined;
    } else {
      lazy.logger.warn("No connection to cancel");
    }
    this.#sendNotifications();
  }

  async purgeOuinetCache() {
    lazy.logger.debug("Purging Ouinet cache");

    while (
      this.#ouinetStage == OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage == OuinetStages.StartingProcess
    ) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (
      this.#ouinetStage == OuinetStages.Connected ||
      this.#ouinetStage == OuinetStages.Degraded
    ) {
      await this.#getFromOuinetFrontend(`${this.#endpoints.frontend_set_value}?purge_cache=do`);
      this.#apiPollTimeoutResolver();
    }
  }

  async newIdentity() {
    while (
      this.#ouinetStage == OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage == OuinetStages.StartingProcess
    ) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

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
