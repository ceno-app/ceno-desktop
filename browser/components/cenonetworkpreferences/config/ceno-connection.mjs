import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

const {
  CenoNetwork,
  CenoNetworkTopics,
  InternetStatus,
  OuinetStages,
  OuinetPrefs,
} = ChromeUtils.importESModule("resource://gre/modules/CenoNetwork.sys.mjs");

// Keep ouinetStageToL10n in sync with ouinetConnectTitlebarStatus.js
export function ouinetStageToL10n(state, internetStatus) {
  switch (state) {
    case OuinetStages.Connected:
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-connected";

    case OuinetStages.Degraded:
      if (internetStatus === InternetStatus.Online) {
        return "ceno-browser-ouinet-preferences-ouinet-connection-status-degraded";
      }
      return "ceno-browser-ouinet-preferences-ouinet-connection-status-local-cache";
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
}

let cachedState = null;
const state = () => (cachedState ??= CenoNetwork.CenoNetworkState());

function formatSize(value) {
  let b = Number(value);
  if (isNaN(b)) {
    b = 0;
  }
  if (b < 1024) {
    return b + " B";
  }
  // See <https://stackoverflow.com/a/42408230>.
  const i = Math.floor(Math.log2(b) / 10);
  const v = b / Math.pow(1024, i);
  const u = "KMGTPEZY"[i-1] + "iB";
  return `${v.toFixed(2)} ${u}`;
}

function openLogFile() {
  const path = state().logfile;
  if (path) {
    window.open("file://" + path, "_blank");
  }
}

Preferences.addAll([
  { id: OuinetPrefs.quickstart, type: "bool" },
  { id: OuinetPrefs.headless, type: "bool" },
  { id: OuinetPrefs.bridge, type: "bool" },
  { id: OuinetPrefs.udp_mux_port, type: "int" },
  { id: OuinetPrefs.udp_mux_port_random, type: "bool" },
  { id: OuinetPrefs.origin_access, type: "bool" },
  { id: OuinetPrefs.proxy_access, type: "bool" },
  { id: OuinetPrefs.injector_access, type: "bool" },
  { id: OuinetPrefs.distributed_cache, type: "bool" },

  { id: OuinetPrefs.logging_level, type: "string" },
  { id: OuinetPrefs.metrics, type: "bool" },
]);

Preferences.addSetting({
  id: "cenoOuinetStage",
  setup(emitChange) {
    const observer = {
      observe(subject) {
        cachedState = subject?.wrappedJSObject ?? CenoNetwork.CenoNetworkState();
        emitChange();
      },
    };
    Services.obs.addObserver(observer, CenoNetworkTopics.StateChange);
    return () => {
      Services.obs.removeObserver(observer, CenoNetworkTopics.StateChange);
      cachedState = null;
    };
  },
  get() {
    return state().ouinetStage;
  },
  getControlConfig(config) {
    const s = state();
    return { ...config, l10nId: ouinetStageToL10n(s.ouinetStage, s.internetStatus) };
  }
});

Preferences.addSetting({
  id: "cenoConnect",
  deps: ["cenoOuinetStage"],
  visible: () => [OuinetStages.Init, OuinetStages.Exited, OuinetStages.Error].includes(state().ouinetStage),
  onUserClick() {
    CenoNetwork.connect();
  }
});

Preferences.addSetting({
  id: "cenoCancel",
  deps: ["cenoOuinetStage"],
  visible: () => [OuinetStages.StartingProcess, OuinetStages.ConnectingToNetwork].includes(state().ouinetStage),
  onUserClick() {
    CenoNetwork.cancel();
  }
});

Preferences.addSetting({
  id: "cenoDisconnect",
  deps: ["cenoOuinetStage"],
  visible: () => [OuinetStages.Connected, OuinetStages.Degraded].includes(state().ouinetStage),
  onUserClick() {
    CenoNetwork.cancel();
  }
});

Preferences.addSetting({
  id: "cenoEnableLoggingAndReconnect",
  deps: ["cenoOuinetStage"],
  visible: () => state().errors.failed_to_start_suggest_logging,
  onUserClick() {
    CenoNetwork.enableLoggingAndConnect();
  }
});

Preferences.addSetting({
  id: "cenoMsgOffline",
  deps: ["cenoOuinetStage"],
  visible: () => state().internetStatus !== InternetStatus.Online,
});

Preferences.addSetting({
  id: "cenoMsgFirewall",
  deps: ["cenoOuinetStage"],
  visible: () => state().errors.firewall,
});
Preferences.addSetting({
  id: "cenoAllowFirewall",
  deps: ["cenoOuinetStage"],
  visible: () => state().errors.firewall,
  onUserClick() {
    CenoNetwork.allowFirewall();
  }
});

Preferences.addSetting({
  id: "cenoMsgFailedToStart",
  deps: ["cenoOuinetStage"],
  visible: () => state().errors.failed_to_start || state().errors.failed_to_start_show_log || state().errors.failed_to_start_suggest_logging,
});
Preferences.addSetting({
  id: "cenoShowLog",
  deps: ["cenoOuinetStage"],
  visible: () => state().errors.failed_to_start_show_log,
  onUserClick() {
    openLogFile();
  }
});

Preferences.addSetting({
  id: "cenoMsgUdpMismatch",
  deps: ["cenoOuinetStage"],
  visible: () => state().errors.udp_mux_port_mismatch,
  getControlConfig(config) {
    const s = state();
    return {
      ...config,
      l10nArgs: {
        requested: String(s.udp_mux_port_requested),
        actual: String(s.udp_mux_port_actual),
      },
    };
  }
});

Preferences.addSetting({
  id: "cenoMsgPersonalUnreachable",
  deps: ["cenoOriginAccess", "cenoProxyAccess"],
  visible: deps => !deps.cenoOriginAccess.value && !deps.cenoProxyAccess.value,
});

Preferences.addSetting({
  id: "cenoMsgPublicUnreachable",
  deps: ["cenoOriginAccess", "cenoInjectorAccess", "cenoDistributedCache"],
  visible: deps =>
    !deps.cenoOriginAccess.value &&
    !deps.cenoInjectorAccess.value &&
    !deps.cenoDistributedCache.value,
});

const STATUS_ROWS = {
  cenoUpnpStatus: {
    getValue: () => state().upnp,
    valueL10n: "ceno-browser-ouinet-preferences-upnp",
    emptyL10n: "ceno-browser-ouinet-preferences-upnp-undecided",
  },
  cenoLocalUdp: {
    getValue: () => state().local_udp,
    valueL10n: "ceno-browser-ouinet-preferences-local-udp",
    emptyL10n: "ceno-browser-ouinet-preferences-local-udp-unknown",
  },
  cenoPublicUdp: {
    getValue: () => state().public_udp,
    valueL10n: "ceno-browser-ouinet-preferences-public-udp",
    emptyL10n: "ceno-browser-ouinet-preferences-public-udp-unknown",
  },
};
for (let [id, row] of Object.entries(STATUS_ROWS)) {
  Preferences.addSetting({
    id,
    deps: ["cenoOuinetStage"],
    getControlConfig(config) {
      const value = row.getValue();
      return value == null ?
        { ...config, l10nId: row.emptyL10n } :
        { ...config, l10nId: row.valueL10n, l10nArgs: { value } };
    },
    visible: () => [OuinetStages.Connected, OuinetStages.Degraded].includes(state().ouinetStage),
  });
}

const TOGGLES = {
  cenoQuickstart: OuinetPrefs.quickstart,
  cenoHeadless: OuinetPrefs.headless,
  cenoBridge: OuinetPrefs.bridge,
  cenoOriginAccess: OuinetPrefs.origin_access,
  cenoProxyAccess: OuinetPrefs.proxy_access,
  cenoInjectorAccess: OuinetPrefs.injector_access,
  cenoDistributedCache: OuinetPrefs.distributed_cache,
  cenoMetricsEnabled: OuinetPrefs.metrics,
  cenoUdpMuxPortRandom: OuinetPrefs.udp_mux_port_random,
};
for (let [id, pref] of Object.entries(TOGGLES)) {
  Preferences.addSetting({ id: id, pref: pref });
}

Preferences.addSetting({
  id: "cenoUdpMuxPort",
  pref: OuinetPrefs.udp_mux_port,
  deps: ["cenoUdpMuxPortRandom"],
  disabled: deps => deps.cenoUdpMuxPortRandom.value,
  set: value => Math.min(65535, Math.max(1, parseInt(value, 10)) || 1),
});

Preferences.addSetting({
  id: "cenoLoggingLevel",
  pref: OuinetPrefs.logging_level,
});

Preferences.addSetting({
  id: "cenoLoggingShowLog",
  deps: ["cenoOuinetStage"],
  disabled: () => !state().logfile,
  onUserClick() {
    openLogFile();
  }
});

Preferences.addSetting({
  id: "cenoCacheSize",
  deps: ["cenoOuinetStage"],
  getControlConfig(config) {
    return {
      ...config,
      l10nId: "ceno-browser-ouinet-preferences-local-cache-size",
      l10nArgs: { size: formatSize(state().local_cache_size) },
    };
  },
});

Preferences.addSetting({
  id: "cenoPurgeCache",
  deps: ["cenoOuinetStage"],
  disabled: () => state().local_cache_size === undefined,
  onUserClick() {
    CenoNetwork.purgeOuinetCache();
  }
});

SettingGroupManager.registerGroups({
  cenoStatus: {
    l10nId: "ceno-browser-ouinet-preferences-heading",
    headingLevel: 2,
    subcategory: "status",
    items: [
      {
        id: "cenoOuinetStage",
        control: "moz-box-item",
        items: [
          { id: "cenoConnect", l10nId: "ceno-browser-ouinet-preferences-connect-button", control: "moz-button", slot: "actions" },
          { id: "cenoCancel", l10nId: "ceno-browser-ouinet-preferences-cancel-button", control: "moz-button", slot: "actions" },
          { id: "cenoDisconnect", l10nId: "ceno-browser-ouinet-preferences-disconnect-button", control: "moz-button", slot: "actions" },
          { id: "cenoAllowFirewall", l10nId: "ceno-browser-ouinet-preferences-allow-firewall-button", control: "moz-button", slot: "actions" },
          { id: "cenoEnableLoggingAndReconnect", l10nId: "ceno-browser-ouinet-preferences-enableloggingandreconnect-button", control: "moz-button", slot: "actions" },
          { id: "cenoShowLog", l10nId: "ceno-browser-ouinet-preferences-show-log-button", control: "moz-button", slot: "actions" },
        ],
      },
      { id: "cenoMsgOffline", l10nId: "ceno-browser-ouinet-preferences-link-status-offline", control: "moz-message-bar", controlAttrs: { type: "warning" } },
      { id: "cenoMsgFirewall", l10nId: "ceno-browser-ouinet-preferences-error-firewall-blocked", control: "moz-message-bar", controlAttrs: { type: "warning" } },

      { id: "cenoMsgFailedToStart", l10nId: "ceno-browser-ouinet-preferences-error-failed-to-start", control: "moz-message-bar", controlAttrs: { type: "error" } },

      { id: "cenoMsgUdpMismatch", l10nId: "ceno-browser-ouinet-preferences-error-udp-port-mismatch", control: "moz-message-bar", controlAttrs: { type: "info" } },

      { id: "cenoUpnpStatus", control: "moz-box-item" },
      { id: "cenoLocalUdp", control: "moz-box-item" },
      { id: "cenoPublicUdp", control: "moz-box-item" },
    ],
  },
  cenoModes: {
    l10nId: "ceno-browser-ouinet-preferences-client-preferences-heading",
    headingLevel: 2,
    subcategory: "modes",
    items: [
      { id: "cenoQuickstart", l10nId: "ceno-browser-ouinet-preferences-quickstart", control: "moz-toggle" },
      { id: "cenoHeadless", l10nId: "ceno-browser-ouinet-preferences-headless", control: "moz-toggle" },
      { id: "cenoBridge", l10nId: "ceno-browser-ouinet-preferences-bridge", control: "moz-toggle" },
      { id: "cenoUdpMuxPort", l10nId: "ceno-browser-ouinet-preferences-udp-mux-port", control: "moz-input-text", controlAttrs: { type: "number", min: 1, max: 65535 } },
      { id: "cenoUdpMuxPortRandom", l10nId: "ceno-browser-ouinet-preferences-udp-mux-port-random", control: "moz-toggle" },
    ],
  },
  cenoSources: {
    l10nId: "ceno-browser-ouinet-preferences-sources-heading",
    headingLevel: 2,
    subcategory: "sources",
    items: [
      { id: "cenoMsgPersonalUnreachable", l10nId: "ceno-browser-ouinet-preferences-sources-personal-unreachable", control: "moz-message-bar", controlAttrs: { type: "warning" } },
      { id: "cenoMsgPublicUnreachable", l10nId: "ceno-browser-ouinet-preferences-sources-public-unreachable", control: "moz-message-bar", controlAttrs: { type: "warning" } },
      { id: "cenoOriginAccess", l10nId: "ceno-browser-ouinet-preferences-sources-origin-access", control: "moz-toggle" },
      { id: "cenoProxyAccess", l10nId: "ceno-browser-ouinet-preferences-sources-proxy-access", control: "moz-toggle" },
      { id: "cenoInjectorAccess", l10nId: "ceno-browser-ouinet-preferences-sources-injector-access", control: "moz-toggle" },
      { id: "cenoDistributedCache", l10nId: "ceno-browser-ouinet-preferences-sources-distributed-cache", control: "moz-toggle" },
    ],
  },
  cenoLocalCache: {
    l10nId: "ceno-browser-ouinet-preferences-local-cache",
    headingLevel: 2,
    subcategory: "local-cache",
    items: [
      { id: "cenoCacheSize", control: "moz-box-item" },
      { id: "cenoPurgeCache", l10nId: "ceno-browser-ouinet-preferences-local-cache-clear-button", control: "moz-button" },
    ],
  },
  cenoLogging: {
    l10nId: "ceno-browser-ouinet-preferences-logging-heading",
    headingLevel: 2,
    subcategory: "logging",
    items: [
      {
        id: "cenoLoggingLevel",
        l10nId: "ceno-browser-ouinet-preferences-logging-level",
        control: "moz-select",
        options: ["silly", "debug", "verbose", "info", "warn", "error", "abort", "disabled"]
          .map(value => ({ value, l10nId: `logging-level-${value}` })),
      },
      { id: "cenoLoggingShowLog", l10nId: "ceno-browser-ouinet-preferences-show-log-button", control: "moz-button" },
    ],
  },
  cenoMetrics: {
    l10nId: "ceno-browser-ouinet-preferences-metrics-heading",
    headingLevel: 2,
    items: [
      { id: "cenoMetricsEnabled", l10nId: "ceno-browser-ouinet-preferences-metrics-checkbox", control: "moz-toggle" },
    ],
  },
});
