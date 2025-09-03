import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";

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

const CenoHomePrefs = Object.freeze({
  log_level: "ceno.cenohome.log_level",
  quickstart: "ceno.cenohome.quickstart",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () =>
  console.createInstance({
    maxLogLevelPref: CenoHomePrefs.log_level,
    prefix: "CenoHome",
  })
);

// Keep CenoHomeStateName in sync with aboutCenoHome.js
export const CenoHomeStateName = Object.freeze({
  Init: "Init",
  StartingProcess: "StartingProcess",
  ConnectingToNetwork: "ConnectingToNetwork",
  Connected: "Connected",
  Exited: "Exited",
  Error: "Error",
});
/**
 * @typedef {object} CenoHomeState
 * @property {CenoHomeStateName} [name]
 * @property {int} [connectingToNetworkProgress]
 * @property {string?} [error]
 */

// Keep CenoHomeErrors in sync with aboutCenoHome.js
const CenoHomeErrors = Object.freeze({
  MissingOuinetBinary: "MissingOuinetBinary",
  MissingDataDir: "MissingDataDir",
  OuinetStartupError: "OuinetStartupError",
});

export const InternetStatus = Object.freeze({
  Unknown: -1,
  Offline: 0,
  Online: 1,
});

/* Topics Notified by the CenoHome module */
export const CenoHomeTopics = Object.freeze({
  StateChange: "cenohome:state-change",
  QuickstartChange: "cenohome:quickstart-change",
  InternetStatusChange: "cenohome:internet-status-change",
});

class _CenoHome {
  #internetStatus = InternetStatus.Unknown;
  get internetStatus() {
    return this.#internetStatus;
  }
  #updateInternetStatus() {
    let newStatus;
    if (lazy.NetworkLinkService?.linkStatusKnown) {
      newStatus = lazy.NetworkLinkService.isLinkUp
        ? InternetStatus.Online
        : InternetStatus.Offline;
    } else {
      newStatus = InternetStatus.Unknown;
    }

    if (newStatus === this.#internetStatus) {
      return;
    }
    this.#internetStatus = newStatus;
    Services.obs.notifyObservers(null, CenoHomeTopics.InternetStatusChange);
  }

  /**
   * @type {CenoHomeState}
   */
  #state = {
    name: CenoHomeStateName.Init,
    connectingToNetworkProgress: 0,
    error: null,
  }

  get state() {
    return this.#state;
  }
  #setState(newStateName) {
    if (newStateName === this.#state.name) {
      return;
    }

    this.#state.connectingToNetworkProgress = 0;
    this.#state.error = null;

    if (newStateName === CenoHomeStateName.StartingProcess) {
      this.#state.connectingToNetworkProgress = 33;
    } else if (newStateName === CenoHomeStateName.ConnectingToNetwork) {
      this.#state.connectingToNetworkProgress = 66;
    } else if (newStateName === CenoHomeStateName.Connected) {
      this.#state.connectingToNetworkProgress = 100;
    }
    this.#state.name = newStateName;
    Services.obs.notifyObservers(structuredClone(this.#state), CenoHomeTopics.StateChange);
  }

  #setErrorState(errorName) {
    this.#state.name = CenoHomeStateName.Error;
    this.#state.connectingToNetworkProgress = 0;
    this.#state.error = errorName;
    Services.obs.notifyObservers(structuredClone(this.#state), CenoHomeTopics.StateChange);
  }

  // @TODO: Endpoint port number will be dynamic
  #api_status_endpoint = "http://127.0.0.1:8078/api/status";

  async #pollApiStatus() {
    // retry delay doubles on each failed try
    let initial_retry_delay_seconds = 1000;
    let isConnected = false;
    while (!isConnected && this.#state.name === CenoHomeStateName.ConnectingToNetwork) {
      try {
        const response = await fetch(this.#api_status_endpoint);
        if (response.ok) {
          const json = await response.json();
          isConnected = json.state === 'started';
          if (!isConnected) {
            lazy.logger.debug(json);
          }
        }
      } catch (e) {
        lazy.logger.error('Failed to get ouinet API status', e);
      }
      if (!isConnected) {
        // @TODO: timeout could be cleared, without clearing it wakes up after a delay and exits later
        await new Promise(resolve => setTimeout(() => resolve(), initial_retry_delay_seconds));
        initial_retry_delay_seconds *= 2;
      }
    }
    if (this.#state.name === CenoHomeStateName.ConnectingToNetwork) {
      this.#setState(CenoHomeStateName.Connected);
    }
  }

  // init should be called by OuinetStartupService
  init() {
    let observeTopic = addTopic => {
      Services.obs.addObserver(this, addTopic);
      lazy.logger.debug(`Observing topic '${addTopic}'`);
    };

    observeTopic(NETWORK_LINK_TOPIC);

    this.#updateInternetStatus();

    if (this.quickstart) {
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

  #ouinetProcess = null;

  async connect() {
    lazy.logger.debug("CenoHome.connect()");
    if (
      this.#state.name === CenoHomeStateName.Init ||
      this.#state.name === CenoHomeStateName.Exited ||
      this.#state.name === CenoHomeStateName.Error
    ) {
      this.#setState(CenoHomeStateName.StartingProcess);
      this.#ouinetProcess = new lazy.OuinetProcess();
      this.#setState(CenoHomeStateName.ConnectingToNetwork);

      try {
        await this.#ouinetProcess.start();

        this.#ouinetProcess.onExit = _exitCode => {
          if (this.#state.name !== CenoHomeStateName.Exited) {
            this.#setState(CenoHomeStateName.Init);
          }
        };

        this.#pollApiStatus();

        // @TODO: remove hard-coded delay before installing cert,
        // should detect if ouinet has created the cert file before proceeding
        await new Promise(resolve => setTimeout(() => resolve(), 5000));
        lazy.OuinetLauncherUtil.setRootCertificate()

      } catch (e) {
        if (e instanceof lazy.MissingDataDirError) {
          this.#setErrorState(CenoHomeErrors.MissingDataDir);
        } else if (e instanceof lazy.MissingOuinetBinaryError) {
          this.#setErrorState(CenoHomeErrors.MissingOuinetBinary);
        } else {
          this.#setErrorState(CenoHomeErrors.OuinetStartupError);
        }
      }
    } else {
      lazy.logger.warn("Ignoring double connect request", this.#state);
    }
  }

  cancel() {
    lazy.logger.debug("CenoHome.cancel()");

    if (
      this.#state.name === CenoHomeStateName.ConnectingToNetwork ||
      this.#state.name === CenoHomeStateName.Connected
    ) {
      if (this.#ouinetProcess) {
        this.#ouinetProcess.stop();
        this.#setState(CenoHomeStateName.Exited);
        this.#ouinetProcess = null;
      }
    } else {
      lazy.logger.warn("No connection to cancel");
    }
  }

  async observe(subject, topic) {
    lazy.logger.debug(`Observed ${topic}`);

    switch (topic) {
      case NETWORK_LINK_TOPIC:
        this.#updateInternetStatus();
        break;
    }
  }

  /**
   * Whether ouinet can start immediately once Ceno Browser has been opened.
   *
   * @type {boolean}
   */
  get quickstart() {
    return Services.prefs.getBoolPref(CenoHomePrefs.quickstart, false);
  }
  set quickstart(isEnabled) {
    isEnabled = Boolean(isEnabled);
    if (isEnabled === this.quickstart) {
      return;
    }
    Services.prefs.setBoolPref(CenoHomePrefs.quickstart, isEnabled);
    Services.obs.notifyObservers(null, CenoHomeTopics.QuickstartChange);
  }
};

export const CenoHome = new _CenoHome();
