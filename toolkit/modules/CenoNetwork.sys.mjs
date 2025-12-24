import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { AsyncSocket } from "resource://gre/modules/AsyncSocket.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  MissingDataDirError: "resource://gre/modules/OuinetProcess.sys.mjs",
  MissingOuinetBinaryError: "resource://gre/modules/OuinetProcess.sys.mjs",
  OuinetStartupError: "resource://gre/modules/OuinetProcess.sys.mjs",
  OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
  OuinetProcess: "resource://gre/modules/OuinetProcess.sys.mjs",
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
});

ChromeUtils.defineLazyGetter(lazy, "logger", () =>
  console.createInstance({
    maxLogLevelPref: CenoNetworkPrefs.log_level,
    prefix: "CenoNetwork",
  })
);

// Keep CenoNetworkErrors in sync with aboutCenoHome.js
export const CenoNetworkErrors = Object.freeze({
  MissingOuinetBinary: "MissingOuinetBinary",
  MissingDataDir: "MissingDataDir",
  OuinetStartupError: "OuinetStartupError",
});
export function CenoNetworkErrorToL10n(error) {
  switch (error) {
    case CenoNetworkErrors.MissingOuinetBinary:
      return "ceno-browser-about-ceno-home-error-missing-ouinet-binary";
    case MissingDataDir:
      return "ceno-browser-about-ceno-home-error-missing-ouinet-data-dir";
    case OuinetStartupError:
      return "ceno-browser-about-ceno-home-error-ouinet-startup";
  }
}

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

  #ouinetProcess = null;

  #credentials = {
    frontend_token: null,
    proxy_user: 'user',
    proxy_password: null,
  }
  #endpoints = {
    proxy: null,
    frontend_unix_socket: lazy.OuinetLauncherUtil.getOuinetFile("frontend_unix_socket", false),
    frontend_tcp: 'http://127.0.0.1:8078',

    frontend_get_api_status: '/api/status',
    frontend_set_value: '/',
    frontend_get_endpoints: '/api/endpoints',
  }

  #ouinetState = {
    origin_access: undefined,
    proxy_access: undefined,
    injector_access: undefined,
    distributed_cache: undefined,

    local_cache_size: undefined,
    logging: undefined,
    metrics: undefined,

    reachability: undefined,
    upnp: undefined,
    local_udp: undefined,
    public_udp: undefined,
    // bridge_announcement: undefined,
    bt_extra_bootstraps: undefined,
  }
  #resetOuinetState() {
    this.#ouinetState.origin_access = undefined;
    this.#ouinetState.proxy_access = undefined;
    this.#ouinetState.injector_access = undefined;
    this.#ouinetState.distributed_cache = undefined;
    this.#ouinetState.local_cache_size = undefined;
    this.#ouinetState.logging = undefined;
    this.#ouinetState.metrics = undefined;
    this.#ouinetState.reachability = undefined;
    this.#ouinetState.upnp = undefined;
    this.#ouinetState.local_udp = undefined;
    this.#ouinetState.public_udp = undefined;
    // this.#ouinetState.bridge_announcement = undefined;
    this.#ouinetState.bt_extra_bootstraps = undefined;
  }

  CenoNetworkState() {
    let res = structuredClone(this.#ouinetState);
    res['ouinetStage'] = this.#ouinetStage;
    res['internetStatus'] = this.#internetStatus;
    res['error'] = this.#error
    res['quickstart'] = this.#quickstart;

    const logFile = lazy.OuinetLauncherUtil.getOuinetFile("logfile", false);
    res['logfile'] = logFile.exists() ? logFile.path : undefined;

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

  // init is called by OuinetStartupService
  init() {
    Services.obs.addObserver(this, NETWORK_LINK_TOPIC);
    this.#updateInternetStatus();

    if (this.#quickstart) {
      this.connect();
    }
  }

  uninit() {
    Services.obs.removeObserver(this, NETWORK_LINK_TOPIC);

    if (this.#ouinetProcess) {
      this.#ouinetProcess.stop();
      this.#ouinetProcess = null;
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

    return {
      ok: header[0].includes('200'),
      header: header,
      body: header_and_body.length === 2 ? header_and_body[1] : null,
      json: async function() {
        return JSON.parse(header_and_body[1]);
      }
    };
  }

  async #getApiEndpoints() {
    while (
      this.#ouinetStage === OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage === OuinetStages.Degraded ||
      this.#ouinetStage === OuinetStages.Connected
    ) {
      try {
        const response = await this.#getFromOuinetFrontend(this.#endpoints.frontend_get_endpoints);
        if (response.ok) {
          const json = await response.json();
          this.#endpoints.proxy = json.proxy_endpoint;
          this.#endpoints.frontend_tcp = 'http://' + json.frontend_tcp_endpoint;
          break;
        } else {
          lazy.logger.error(response);
        }
      } catch (e) {
        lazy.logger.error('Failed to get ouinet endpoints', e);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
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
  async #pollApiStatus() {
    const interval_startup = 1000;
    const interval_runtime = 5000;
    while (
      this.#ouinetStage === OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage === OuinetStages.Degraded ||
      this.#ouinetStage === OuinetStages.Connected
    ) {
      try {
        const response = await this.#getFromOuinetFrontend(this.#endpoints.frontend_get_api_status);
        if (response.ok) {
          const json = await response.json();
          if (json.state === 'started') {
            this.#setOuinetStage(OuinetStages.Connected, false);
          } else if (json.state === 'degraded') {
            this.#setOuinetStage(OuinetStages.Degraded, false);
          }

          this.#ouinetState = {
            origin_access: json.origin_access,
            proxy_access: json.proxy_access,
            injector_access: json.injector_access,
            distributed_cache: json.distributed_cache,

            local_cache_size: json.local_cache_size,
            logging: json.logfile,
            metrics: json.metrics_enabled,

            reachability: json.udp_world_reachable,
            upnp: json.is_upnp_active,
            local_udp: json.local_udp_endpoints.join(', '),
            public_udp: json.public_udp_endpoints.join(', '),
            // bridge_announcement: json.bridge_announcement,
            bt_extra_bootstraps: json.bt_extra_bootstraps,
          };
          this.#sendNotifications();
        } else {
          lazy.logger.error(response);
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

  async setValueInAPI(element_id, newValue) {
    try {
      lazy.logger.info(`Attempting to set ${element_id}=${newValue ? 'enable' : 'disable'}`);
      const setValueResult = await this.#getFromOuinetFrontend(`${this.#endpoints.frontend_set_value}?${element_id}=${newValue ? 'enable' : 'disable'}`);
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
      lazy.logger.debug("extensionOnConnect() inner");
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
      lazy.logger.debug("extensionOnDisconnect() inner");
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
      this.#ouinetStage === OuinetStages.Init ||
      this.#ouinetStage === OuinetStages.Exited ||
      this.#ouinetStage === OuinetStages.Error
    ) {
      this.#setOuinetStage(OuinetStages.StartingProcess, true);
      this.#ouinetProcess = new lazy.OuinetProcess();
      try {
        this.#credentials.frontend_token = randomString(16);
        this.#credentials.proxy_password = randomString(16);
        await this.#ouinetProcess.start(this.#credentials);
        this.#setOuinetStage(OuinetStages.ConnectingToNetwork, true);

        this.#ouinetProcess.onExit = _exitCode => {
          if (this.#ouinetStage !== OuinetStages.Exited) {
            this.#setOuinetStage(OuinetStages.Init, true);
          }
          this.#resetOuinetState();
          this.#sendNotifications();
        };

        // Let ouinet client start before attempting to communicate with it
        await new Promise(resolve => setTimeout(() => resolve(), 100));

        await this.#getApiEndpoints();
        this.#pollApiStatus();

        // @TODO: remove hard-coded delay before installing cert,
        // should detect if ouinet has created the cert file before proceeding
        await new Promise(resolve => setTimeout(() => resolve(), 5000));
        lazy.OuinetLauncherUtil.setRootCertificate()
      } catch (e) {
        if (e instanceof lazy.MissingDataDirError) {
          this.#setError(CenoNetworkErrors.MissingDataDir);
        } else if (e instanceof lazy.MissingOuinetBinaryError) {
          this.#setError(CenoNetworkErrors.MissingOuinetBinary);
        } else {
          this.#setError(CenoNetworkErrors.OuinetStartupError);
        }
      }
    } else {
      lazy.logger.warn("Ignoring double connect request", this.#ouinetStage);
    }
  }

  cancel() {
    lazy.logger.debug("CenoNetwork.cancel()");

    if (
      this.#ouinetStage === OuinetStages.ConnectingToNetwork ||
      this.#ouinetStage === OuinetStages.Degraded ||
      this.#ouinetStage === OuinetStages.Connected
    ) {
      if (this.#ouinetProcess) {
        this.#ouinetProcess.stop();
        this.#setOuinetStage(OuinetStages.Exited, false);
        this.#ouinetProcess = null;
      }
    } else {
      lazy.logger.warn("No connection to cancel");
    }
    this.#resetOuinetState();
    this.#sendNotifications();
  }

  async observe(_subject, topic) {
    switch (topic) {
      case NETWORK_LINK_TOPIC:
        this.#updateInternetStatus();
        break;
    }
  }
};

export const CenoNetwork = new _CenoNetwork();
