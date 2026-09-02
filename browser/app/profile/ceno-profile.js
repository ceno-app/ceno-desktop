// profile files are processed unordered.
// include them all here for deterministic order
#include 001-base-profile.js
#include firefox.js

pref("browser.startup.homepage", "about:cenohome");
pref("browser.newtabpage.enabled", false);

// Disable homepage override
pref("browser.startup.homepage_override.mstone", "ignore");

// CENO: Do not start into private mode automatically
pref("browser.privatebrowsing.autostart", false);

// CENO: certdb is required for MitM cert injection
pref("security.nocertdb", false);

// Disable site-specific browsing to avoid sharing site icons with the OS. (tor-browser#33855)
pref("browser.ssb.enabled", false);

// Enforce certificate pinning, see: https://bugs.torproject.org/16206
// CENO: set to 1 to allow MiTM
pref("security.cert_pinning.enforcement_level", 1);

// CENO: Enterprise roots required for MitM cert injection
pref("security.enterprise_roots.enabled", true);

// CENO: Quarantined Domains allows built-in Ceno extension to work on restricted domains
pref("extensions.quarantinedDomains.enabled", false);

// const DNS_Mode_DoH_Fallback_to_Plain = 2;
// const DNS_Mode_DoH = 3;
// const DNS_Mode_Plain = 5;
pref("network.trr.mode", 5);

pref("ceno.network.quickstart", false);
pref("ceno.network.headless", false);
pref("ceno.network.bridge", true);

pref("ceno.network.origin_access", true);
pref("ceno.network.proxy_access", true);
pref("ceno.network.injector_access", true);
pref("ceno.network.distributed_cache", true);
pref("ceno.network.logging_level", "disabled");
pref("ceno.network.metrics", true);

pref("ceno.network.doh_mode", 2);

pref("ceno.network.udp_mux_port", 28729);
pref("ceno.network.udp_mux_port_random", true);

pref("ceno.browser.log_level", "Debug");

pref("ceno.eqsat.enabled", false);
pref("ceno.eqsat.add_www_subdomain", "bbc.com,iranwire.com,iranintl.com,radiofarda.com,radiozamaneh.com");
pref("ceno.eqsat.append_slash", "tg.ceno.app");

pref("network.captive-portal-service.enabled", false);
