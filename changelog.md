# Ceno Browser for Desktop Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.6] - 2026-07-27
### Fixed
- Reopening tabs on startup with Ceno Network autoconnect used to show proxy refusal error. This change prevents tab from loading resources while connecting/disconnect to Ceno Network and also on startup until the Ceno Network connection is established or the connection errors out.

### Changed
- Weblate updates to Ceno extension

## [0.1.5] - 2026-07-20
### Changed
- Updated Base Browser to 140.13.0esr-15.0-1-build1

## [0.1.4] - 2026-07-16
### Changed
- Updated Base Browser to 140.12.0esr-15.0-1-build3 (previously was build2)
- Updated CA Certificates

## [0.1.3] - 2026-07-15
### Changed
- Updated Base Browser to 140.12.0esr
- Updated Ouinet to 1.6.8 (improvements in exiting and restarting ceno-network-client)

## [0.1.2] - 2026-06-04

### Changed
- eQsat Package Importer is hidden behind `about:config` preference `ceno.eqsat.enabled`
- Clearing Ceno Network cache clears results from about:eqsat
- Visual updates in about:eqsat
- Updated translations

## [0.1.1] - 2026-06-01

### Added
- eQsat package importer. There are 2 types of packages, base and update. First import base package, then it's possible to import incremental update packages. eQsat package importer is accessible by a toolbar button. Packages can also be imported by dragging and dropping into the Ceno Browser or using regular file open dialog from the browser. eQsat packages have .zip or .ceno file extension. Installer suggests adding .ceno file association for Ceno Browser
- Added code signing code to build process to sign .exe's and .dll's which are packaged to installers. (Currently we are still using self-signed certificate)

### Changed
- Updated Base Browser to 140.11.0esr
- Updated CA certificate

## [0.0.13] - 2026-04-13

### Changed
- Ceno Network Client icon is colored when it's at least somewhat usable. Connected, degraded or degraded while offline. If it can be used, the connection is colored. Icon is gray if it's in an unusable state, such as starting, exiting or restarting. Same logic for icon browser's titlebar.
- Updated Ouinet to [v1.6.6](https://gitlab.com/equalitie/ouinet/-/releases/v1.6.6)
- Detect when Ceno Network Client is unresponsive and restart it if it does not become responsive in couple of seconds.
- Updated network state (online/offline) detection in Ceno Browser to match the state of Ceno Network client. Previously browser would use code from Firefox, which only checks if there are any active interfaces. Current code lets Windows decide if the network connection is active. This network status is used to display warnings which could help undertand why the browser cannot load anything.

### Fixed
- Fixed an error which prevented disabling of origin_access, proxy_access, injector_access, distributed_cache and logfile at runtime
- Fixed an error where Ceno Browser would fail to open properly from Ceno Network Client. It used to show an error about unresponsive instance.

##  [0.0.12] - 2026-04-02

### Added
- Added Firewall integration. Add firewall rule for Microsoft Store builds during install, currently needs to be done manually when generating msix, see [msix-firewall-guide.md](msix-firewall-guide.md). Detect if Ceno Network Client is blocked by firewall. Show button to add firewall rule if blocking is detected.
- Option to control what UDP port should Ceno Network Client listen on for connections from other nodes. UDP Mux Port. Defaults to random port, but allowing custom ports. Error is shown if requested custom port was not acquired and a random port was used instead.

### Changed
- Major update to Ceno Network Client
    - Ouinet integrated as a .dll library instead of wrapping client.exe.
    - Ouinet's state displayed visually as different tray icons, either colored or gray Ceno C letter with different tooltip texts.
    - Network state is monitored to detect changes which trigger an internal restart of Ouinet. Changes such as wifi connection or disconnection, IP address modification and so on. Tray icon turns gray during the restart.
    - Failed program startup errors displayed as error windows instead of silent exits.
- Updated DNS over HTTPS config, allowing both HTTPS and unencrypted DNS requests. Setting moved to "Privacy & Security" where Firefox usually has it.
- Updates to Connection preferences page. Show detected errors (failed Ceno-Network-Client startup, no internet). Button to enable logging is shown on failed Ceno-Network-Client startup if logging is disabled, if logging is enabled and logfile exists, a link to logfile is shown instead.
- Updates to manage lifecycle of Ceno-Network-Client in Ceno Browser, removed startup timeouts which were commonly exceeded on first startup in Microsoft store builds.
- Logging level and enable/disable toggle merged into single drop down menu.
- uBlock origin updated to 1.70.0

### Fixed
- logfile link no longer displayed when logging is not enabled.

### Removed
- Removed Ouinet's client.exe and .a libraries from installer packages.

## [0.0.11]
### Changed
- Updated base browser to version 140.7.1esr
### Fixed
- Fixed issue in microsoft store build which prevented Ceno network client from starting.
- Fixed issue which prevented uninstaller from being built.
- Fixed logging settings toggle for Ceno network client.
