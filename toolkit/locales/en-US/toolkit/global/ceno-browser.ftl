ceno-browser-about-ceno-home-title = Ceno Homepage

ceno-browser-about-ceno-home-description-1 = Ceno has two modes of operation - <strong>Public</strong> and <strong>Personal</strong>.
ceno-browser-about-ceno-home-description-2 = You can easily toggle between them via the Ceno button in the toolbar.
ceno-browser-about-ceno-home-description-3 = Public mode offers the best connectivity but the least privacy - websites that you visit or share are recorded in a publicly-accessible registry (BitTorrent).
ceno-browser-about-ceno-home-description-4 = Personal mode eliminates this record but may be slower and less efficient at retrieving content.
ceno-browser-about-ceno-home-description-5 = See the <a data-l10n-name="faq">FAQ</a> for more details on Ceno usage.
ceno-browser-about-ceno-home-description-6 = We're launching a privacy respecting metrics system to help us better understand Ceno users' needs. You can review the details of what we'll collect and how we handle your data in our <a data-l10n-name="privacypolicy">Privacy Policy</a>. You can also opt out at any time via <a data-l10n-name="connectionpreferences">Settings > Connection > Background metrics</a>.
ceno-browser-about-ceno-home-description-7 = Thanks for growing the network! By default, your installation of Ceno for Windows is acting as bridge. By being a bridge, you make the Ceno network stronger and help other Ceno users connect. Note that this will make your public IP address visible to other Ceno users. You can disable Bridge Mode by going to <a data-l10n-name="connectionpreferences">Settings > Connection > Bridge Mode</a> or learn more about <a data-l10n-name="bridgerisks">risks for bridge operators</a> in our FAQ.

ceno-browser-about-ceno-home-quickstart-toggle = Always connect automatically

ceno-browser-about-ceno-home-cancel-button = Cancel
ceno-browser-about-ceno-home-connect-button = Connect
ceno-browser-about-ceno-home-disconnect-button = Disconnect

ceno-browser-about-ceno-home-link-status-offline = Error: Ceno cannot reach internet. Check internet connection.
ceno-browser-about-ceno-home-error-firewall-blocked = Error: Ceno Network Client is blocked by firewall.
ceno-browser-about-ceno-home-allow-firewall = Add Firewall Rule

ceno-browser-about-ceno-home-error-ouinet-failed-to-start-show-log = Error: Failed to start Ceno Network Client. <a data-l10n-name="showlogfile">Show logfile</a>.
ceno-browser-about-ceno-home-error-ouinet-failed-to-start = Error: Failed to start Ceno Network Client.
ceno-browser-about-ceno-home-enableloggingandreconnect-button = Enable Local Logging and Retry

ceno-browser-about-ceno-home-error-udp-port-mismatch = Warning: Failed to acquire requested port <span data-l10n-name="requested">{ $requested }</span>, using port <span data-l10n-name="actual">{ $actual }</span>.

ceno-browser-ouinet-titlebar-status-name = Ceno Network Connection
ceno-browser-ouinet-titlebar-status-not-connected = Not connected to Ceno Network

ceno-browser-ouinet-urlbar-connect-button = Connect to Ceno Network

ceno-browser-ouinet-preferences-heading = Connection
ceno-browser-ouinet-preferences-category =
    .tooltiptext = { ceno-browser-ouinet-preferences-heading }

ceno-browser-ouinet-preferences-internet-connection-status-label = Internet:
ceno-browser-ouinet-preferences-internet-connection-status-online = Online
ceno-browser-ouinet-preferences-internet-connection-status-offline = Offline
ceno-browser-ouinet-preferences-internet-connection-status-unknown = Unknown

ceno-browser-ouinet-preferences-ouinet-connection-status-label = Ceno Network:
ceno-browser-ouinet-preferences-ouinet-connection-status-not-connected = Not Connected
ceno-browser-ouinet-preferences-ouinet-connection-status-connecting = Connecting
ceno-browser-ouinet-preferences-ouinet-connection-status-degraded = Connected (network connection degraded)
ceno-browser-ouinet-preferences-ouinet-connection-status-local-cache = Local Cache Only
ceno-browser-ouinet-preferences-ouinet-connection-status-connected = Connected
ceno-browser-ouinet-preferences-ouinet-connection-status-error = Error
ceno-browser-ouinet-preferences-ouinet-connection-status-exiting = Exiting
ceno-browser-ouinet-preferences-ouinet-connection-status-restarting = Restarting

ceno-browser-ouinet-preferences-automatic-heading = Connect automatically
ceno-browser-ouinet-preferences-automatic-description = Automatically connect to the Ceno network at launch using your current connection settings.
ceno-browser-ouinet-preferences-quickstart-checkbox =
    .label = Always connect automatically

ceno-browser-ouinet-preferences-headless-heading = Ceno Network Service
ceno-browser-ouinet-preferences-headless-description = Your Ceno application can act as a bridge for other Ceno users and also keep your distributed cache available.
ceno-browser-ouinet-preferences-headless-checkbox =
    .label = Keep Ceno Network Service running

ceno-browser-ouinet-preferences-bridge-heading = Bridge Mode
ceno-browser-ouinet-preferences-bridge-description = Note that this will make your public IP address visible to other Ceno users. Changing this setting requires reconnection to Ceno Network.
ceno-browser-ouinet-preferences-bridge-checkbox =
    .label = Enable bridge mode

ceno-browser-ouinet-preferences-udp-mux-port-heading = Incoming Connections Port
ceno-browser-ouinet-preferences-udp-mux-port-description = Ceno Network Client listens for connections from other nodes on this UDP port.
ceno-browser-ouinet-preferences-udp-mux-port-random-checkbox =
    .label = Assign random port
ceno-browser-ouinet-preferences-udp-mux-port = Custom UDP port

ceno-browser-ouinet-preferences-sources-heading = Content retrieval sources
ceno-browser-ouinet-preferences-sources-origin-access =
    .label = (Origin access) Direct from website
ceno-browser-ouinet-preferences-sources-proxy-access =
    .label = (Proxy access) Via the Ceno network (personal)
ceno-browser-ouinet-preferences-sources-injector-access =
    .label = (Injector access) Via the Ceno network (public)
ceno-browser-ouinet-preferences-sources-distributed-cache =
    .label = (Distributed cache) From other Ceno users

ceno-browser-ouinet-preferences-sources-personal-unreachable = ⚠ Personal browsing mode will fail with current settings. Enable origin access or proxy access.
ceno-browser-ouinet-preferences-sources-public-unreachable = ⚠ Public browsing mode will fail with current settings. Enable origin access, injector access or distributed cache.

ceno-browser-ouinet-preferences-logging-heading = Logging
ceno-browser-ouinet-preferences-logging-description = Local logging is used to debug Ceno Network Client
ceno-browser-ouinet-preferences-logging-show-logfile = Show logfile
ceno-browser-ouinet-preferences-logging-level = Logging Level
logging-level-silly = Silly
    .label = Silly
logging-level-debug = Debug
    .label = Debug
logging-level-verbose = Verbose
    .label = Verbose
logging-level-info = Info
    .label = Info
logging-level-warn = Warning
    .label = Warning
logging-level-error = Error
    .label = Error
logging-level-abort = Abort
    .label = Abort
logging-level-disabled = Logging Disabled
    .label = Logging Disabled

ceno-browser-ouinet-preferences-network-heading = Network

ceno-browser-ouinet-preferences-local-cache = Local Cache
ceno-browser-ouinet-preferences-local-cache-size = Size: { $size }
ceno-browser-ouinet-preferences-local-cache-size-unknown = Size unknown while offline
ceno-browser-ouinet-preferences-local-cache-clear-button = Purge now

ceno-browser-ouinet-preferences-local-udp = Local UDP endpoints:
ceno-browser-ouinet-preferences-external-udp = External UDP endpoints:
ceno-browser-ouinet-preferences-public-udp = Public UDP endpoints:

ceno-browser-ouinet-preferences-metrics-heading = Background metrics
ceno-browser-ouinet-preferences-metrics-description = Submit anonymous, privacy respecting metrics to developers
ceno-browser-ouinet-preferences-metrics-checkbox =
    .label = Enable Ceno metrics

ceno-preferences-doh-setting-enabled =
  .label = Default Protection
  .accesskey = D

ceno-preferences-doh-enabled-desc = { -brand-short-name } decides when to use secure DNS to protect your privacy.
ceno-preferences-doh-enabled-detailed-desc-2 = Only use your default DNS resolver if there is a problem with secure DNS

ceno-preferences-doh-strict-desc = { -brand-short-name } will always use secure DNS.
ceno-preferences-doh-strict-detailed-desc-3 = If secure DNS is not available sites will not load or function properly
