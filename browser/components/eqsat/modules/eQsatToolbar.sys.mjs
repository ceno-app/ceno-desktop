const { eQsatExtractor } = ChromeUtils.importESModule("resource:///modules/eQsatExtractor.sys.mjs");
const { getPendingFiles } = ChromeUtils.importESModule("resource:///modules/eQsatCommandLine.sys.mjs");
const { CustomizableUI } = ChromeUtils.importESModule("resource:///modules/CustomizableUI.sys.mjs");

let eqsatQuitObserverStrings = null;

const quitObserver = {
  _quitPromptShowing: false,
  observe(subject, topic, data) {
    if (topic !== "quit-application-requested" || !eQsatExtractor.isExtracting) {
      return;
    }

    // already cancelled by something else
    const cancelQuit = subject.QueryInterface(Ci.nsISupportsPRBool);
    if (cancelQuit.data) {
      return;
    }

    if (this._quitPromptShowing) {      
      cancelQuit.data = true;
      return;
    }

    const win = Services.wm.getMostRecentWindow("navigator:browser");
    if (!win) {
      return;
    }

    this._quitPromptShowing = true;

    const ps = Services.prompt;
    const flags = ps.BUTTON_TITLE_IS_STRING * ps.BUTTON_POS_0 +
                  ps.BUTTON_TITLE_IS_STRING * ps.BUTTON_POS_1;

    const choice = ps.confirmEx(
      win,
      eqsatQuitObserverStrings?.title ?? "eQsat Extractor -- no l10n",
      eqsatQuitObserverStrings?.message ?? "An eQsat package is being imported. Closing now may interrupt the process.",
      flags,
      eqsatQuitObserverStrings?.keepImporting ?? "Keep Importing",  // button 0  -> cancel quit
      eqsatQuitObserverStrings?.exit ?? "Exit",                     // button 1  -> allow quit
      null,                // button 2 (unused)
      null,                // checkbox label
      {}                   // checkbox state
    );

    this._quitPromptShowing = false;

    if (choice === 0) {
      cancelQuit.data = true;
      for (const tab of win.gBrowser.tabs) {
        if (tab.linkedBrowser.currentURI.spec.startsWith("about:eqsat")) {
          win.gBrowser.selectedTab = tab;
          break;
        }
      }
    }
  },
  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
};

Services.obs.addObserver(quitObserver, "quit-application-requested");

const featureGate = "ceno.eqsat.enabled";

export const eQsatToolbar = {
  _started: false,
  async init(window) {
    this._registerActor();
    if (window.MozXULElement) {
      window.MozXULElement.insertFTLIfNeeded("toolkit/global/ceno-browser.ftl");
    }
    await this._getL10nStrings(window);

    this._injectFilePicker(window);
    this._processPendingFiles(window);
    this._interceptFileOpens(window);
    this._interceptFileDrops(window);

    if (!this._started) {
      this._started = true;

      this._prefObserver = {
        observe: (subject, topic, data) => {
          if (data === featureGate) {
            if (Services.prefs.getBoolPref(featureGate)) {
              this._createToolbarButton();
            } else {
              this._removeToolbarButton();
            }
          }
        },
        QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
      };
      Services.prefs.addObserver(featureGate, this._prefObserver, false);
      if (Services.prefs.getBoolPref(featureGate)) {
        this._createToolbarButton();
      }

      this._quitObserver = {
        observe: (subject, topic) => {
          if (topic === "quit-application") {
            this.shutdown();
          }
        },
        QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
      };
      Services.obs.addObserver(this._quitObserver, "quit-application");
    }
  },

  shutdown() {
    if (!this._started) {
      return;
    }
    this._started = false;

    if (this._prefObserver) {
      Services.prefs.removeObserver(featureGate, this._prefObserver);
      this._prefObserver = null;
    }

    if (this._quitObserver) {
      Services.obs.removeObserver(this._quitObserver, "quit-application");
      this._quitObserver = null;
    }
  },

  _interceptFileOpens(window) {
    if (!window.gBrowser || window._eqsatFileInterceptorInstalled) return;
    window._eqsatFileInterceptorInstalled = true;

    window.gBrowser.tabContainer.addEventListener("TabOpen", (event) => {
      const tab = event.target;
      const browser = tab.linkedBrowser;

      const listener = {
        QueryInterface: ChromeUtils.generateQI([
          "nsIWebProgressListener",
          "nsISupportsWeakReference",
        ]),

        onLocationChange(aWebProgress, aRequest, aLocation, aFlags) {
          if (!aWebProgress.isTopLevel) return;

          const spec = aLocation?.spec || "";
          if (!spec.startsWith("file://")) return;
          if (!/\.(ceno|zip)$/i.test(spec)) return;

          browser.stop();

          let file;
          try {
            file = aLocation.QueryInterface(Ci.nsIFileURL).file;
          } catch (e) {
            return;
          }

          try {
            eQsatExtractor.processZipFiles([file]);
          } catch (e) {
            console.error("eQsat: failed to process file", e);
          }

          let eqsatTab = null;
          for (const t of window.gBrowser.tabs) {
            if (t.linkedBrowser.currentURI.spec.startsWith("about:eqsat")) {
              eqsatTab = t;
              break;
            }
          }

          if (eqsatTab) {
            window.gBrowser.selectedTab = eqsatTab;
            if (tab !== eqsatTab) {
              window.gBrowser.removeTab(tab, { animate: false });
            }
          } else {
            browser.loadURI(Services.io.newURI("about:eqsat"), {
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            });
          }

          browser.removeProgressListener(this);
        },

        onStateChange() {},
        onProgressChange() {},
        onStatusChange() {},
        onSecurityChange() {},
      };

      browser.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_LOCATION);
      const cleanup = () => {
        try { browser.removeProgressListener(listener); } catch(e) {}
      };
      tab.addEventListener("TabClose", cleanup, { once: true });
    });
  },

  _interceptFileDrops(window) {
    if (!window.gBrowser || window._eqsatDropInterceptorInstalled) {
      return;
    }
    window._eqsatDropInterceptorInstalled = true;

    const collectFromDirectory = (dir, outFiles) => {
      const stack = [dir];
      while (stack.length > 0) {
        const current = stack.pop();
        const entries = current.directoryEntries;
        while (entries.hasMoreElements()) {
          const entry = entries.getNext().QueryInterface(Ci.nsIFile);
          if (entry.isDirectory()) {
            stack.push(entry);
          } else {
            const path = entry.path.toLowerCase();
            if (path.endsWith(".ceno") || path.endsWith(".zip")) {
              outFiles.push(entry);
            }
          }
        }
      }
    };

    window.addEventListener("dragover", (event) => {
      const dt = event.dataTransfer;
      if (!dt) return;

      for (let i = 0; i < dt.types.length; i++) {
        if (dt.types[i] === "application/x-moz-file" || dt.types[i] === "Files") {
          event.preventDefault();
          dt.dropEffect = "copy";
          break;
        }
      }
    }, true);

    window.addEventListener("drop", (event) => {
      const dt = event.dataTransfer;
      if (!dt) return;

      const files = [];

      for (let i = 0; i < dt.mozItemCount; i++) {
        const types = dt.mozTypesAt(i);
        let isFile = false;
        for (let j = 0; j < types.length; j++) {
          if (types[j] === "application/x-moz-file") {
            isFile = true;
            break;
          }
        }
        if (!isFile) continue;

        try {
          const file = dt.mozGetDataAt("application/x-moz-file", i);
          if (!(file instanceof Ci.nsIFile)) continue;

          if (file.isDirectory()) {
            collectFromDirectory(file, files);
          } else {
            const path = file.path.toLowerCase();
            if (path.endsWith(".ceno") || path.endsWith(".zip")) {
              files.push(file);
            }
          }
        } catch (e) {}
      }

      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      let eqsatTab = null;
      for (const tab of window.gBrowser.tabs) {
        if (tab.linkedBrowser.currentURI.spec.startsWith("about:eqsat")) {
          eqsatTab = tab;
          break;
        }
      }

      if (eqsatTab) {
        window.gBrowser.selectedTab = eqsatTab;
      } else {
        window.openTrustedLinkIn("about:eqsat", "tab");
      }

      eQsatExtractor.processZipFiles(files);
    }, true);
  },

  _processPendingFiles(window) {
    const files = getPendingFiles();
    if (!files.length) {
      return;
    }

    // Defer until the browser window is fully constructed
    Services.tm.idleDispatchToMainThread(() => {
      if (window.closed) return;

      let eqsatTab = null;
      for (const tab of window.gBrowser.tabs) {
        if (tab.linkedBrowser.currentURI.spec.startsWith("about:eqsat")) {
          eqsatTab = tab;
          break;
        }
      }

      if (eqsatTab) {
        window.gBrowser.selectedTab = eqsatTab;
      } else {
        window.openTrustedLinkIn("about:eqsat", "tab");
      }

      eQsatExtractor.processZipFiles(files);
    });
  },

  _registerActor() {
    try {
      ChromeUtils.registerWindowActor("about_eQsat", {
        parent: {
          esModuleURI: "resource:///modules/about_eQsatParent.sys.mjs",
        },
        child: {
          esModuleURI: "resource:///modules/about_eQsatChild.sys.mjs",
          events: { DOMContentLoaded: {} },
        },
        matches: ["about:eqsat"],
      });
    } catch (e) {
      if (e.message?.includes("already registered")) {
        /* ignore on reload */
      } else {
        console.error("Failed to register about_eQsat actor", e);
      }
    }
  },

  _injectFilePicker(window) {
    if (!window.eQsatPickZipFiles) {
      Services.scriptloader.loadSubScript("resource:///modules/eQsatFilePicker.js", window);
    }
  },

  async _getL10nStrings(win) {
    if (win._eqsatPickerStrings) {
      return;
    }
    try {
      const [title, filter] = await win.document.l10n.formatValues([
        "eqsat-filepicker-title",
        "eqsat-filepicker-filter"
      ]);
      win._eqsatPickerStrings = { title, filter };
    } catch (e) {
      console.error(e);
    }
    try {
      const [title, message, keepImporting, exit] = await win.document.l10n.formatValues([
        "eqsat-quit-title",
        "eqsat-quit-message",
        "eqsat-quit-keep-importing",
        "eqsat-quit-exit",
      ]);
      eqsatQuitObserverStrings = { title, message, keepImporting, exit };
    } catch (e) {
      console.error(e);
    }
  },

  _widgetCreated: false,
  _widgetId: "eqsat-extractor-button",
  _createToolbarButton() {
    if (this._widgetCreated) {
      return;
    }
    this._widgetCreated = true;

    CustomizableUI.createWidget({
      id: this._widgetId,
      type: "button",
      defaultArea: CustomizableUI.AREA_NAVBAR,
      label: "eQsat Importer",
      tooltiptext: "Import Extracted eQsat Packages",
      onCreated: function(widgetNode) {
        widgetNode.setAttribute("image", "resource:///modules/eQsat.png");
        widgetNode.ownerDocument.l10n.setAttributes(widgetNode, "eqsat-toolbar-button");
      },
      onCommand: async function(event) {
        const win = event.target.ownerDocument.defaultView;

        const zipFiles = await win.eQsatPickZipFiles();
        if (!zipFiles || zipFiles.length === 0) return;

        let eqsatTab = null;
        for (const tab of win.gBrowser.tabs) {
          if (tab.linkedBrowser.currentURI.spec.startsWith("about:eqsat")) {
            eqsatTab = tab;
            break;
          }
        }

        if (eqsatTab) {
          win.gBrowser.selectedTab = eqsatTab;
        } else {
          win.openTrustedLinkIn("about:eqsat", "tab");
        }

        eQsatExtractor.processZipFiles(zipFiles);
      }
    });
  },

  _removeToolbarButton() {
    if (!this._widgetCreated) {
      return;
    }
    try {
      CustomizableUI.destroyWidget(this._widgetId);
    } catch (e) {
      console.error("Failed to destroy eqsat-extractor-button:", e);
    }
    this._widgetCreated = false;
  },
};
