const lazy = {};
ChromeUtils.defineLazyGetter(lazy, "logger", () =>
  console.createInstance({
    maxLogLevelPref: "ceno.browser.log_level",
    prefix: "NavigationBlocker",
  })
);

class _NavigationBlocker {
  #isPaused = false;
  #windowOpenListener = null;
  #listeners = new WeakMap();

  #isInternalOrLocal(url) {
    try {
      const uri = Services.io.newURI(url);
      switch (uri.scheme) {
        case "about":
        case "chrome":
        case "resource":
        case "file":
          return true;
        case "http":
        case "https":
          if (uri.host === "127.0.0.1" || uri.host === "localhost") {
            return true;
          }
          break;
        default:
          break;
      }
    } catch (e) {
      lazy.logger.error("Failed to parse url: %s", url);
      return true;
    }

    return false;
  }

  #makeProgressListener(win) {
    const blocker = this;
    return {
      onStateChange(aWebProgress, aRequest, aStateFlags, _aStatus) {
        if (!blocker.#isPaused) {
          return;
        }

        if (!(aStateFlags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT)) {
          return;
        }

        if (!(aStateFlags & Ci.nsIWebProgressListener.STATE_START)) {
          return;
        }

        let browser = null;
        for (const tab of win.gBrowser.tabs) {
          const b = tab.linkedBrowser;
          if (b.webProgress === aWebProgress) {
            browser = b;
            break;
          }
        }
        if (!browser) {
          return;
        }

        const tab = win.gBrowser.getTabForBrowser(browser);
        if (!tab) {
          return;
        }

        if (tab._cenoPaused) {
          return;
        }

        let url = null;
        try {
          url = aRequest.QueryInterface(Ci.nsIChannel).originalURI.spec;
        } catch (e) {
          url = browser.currentURI?.spec;
        }

        if (blocker.#isInternalOrLocal(url)) {
          return;
        }

        browser.webNavigation.stop(Ci.nsIWebNavigation.STOP_ALL);
        tab._cenoPaused = true;
        tab._cenoResumeURL = url;
      },

      onLocationChange(_aWebProgress, _aRequest, _aLocation, _aFlags) {
      },

      onProgressChange(_aWebProgress, _aRequest, _aCurSelfProgress, _aMaxSelfProgress, _aCurTotalProgress, _aMaxTotalProgress) {
      },

      onStatusChange(_aWebProgress, _aRequest, _aStatus, _aMessage) {
      },

      onSecurityChange(_aWebProgress, _aRequest, _aState) {
      },

      QueryInterface: ChromeUtils.generateQI([Ci.nsIWebProgressListener, Ci.nsISupports]),
    };
  }

  #attachToWindow(win) {
    if (!win.gBrowser) {
      return;
    }

    if (this.#listeners.has(win)) {
      return;
    }

    const listener = this.#makeProgressListener(win);
    win.gBrowser.addProgressListener(listener);
    this.#listeners.set(win, listener);

    for (const tab of win.gBrowser.tabs) {
      if (tab._cenoPaused) {
        continue;
      }

      const browser = tab.linkedBrowser;
      if (!browser) {
        continue;
      }

      if (browser.webNavigation?.isLoadingDocument) {
        const url = browser.currentURI?.spec;
        if (this.#isInternalOrLocal(url)) {
          continue;
        }

        browser.webNavigation.stop(Ci.nsIWebNavigation.STOP_ALL);
        tab._cenoPaused = true;
        tab._cenoResumeURL = url;
      }
    }
  }

  #detachFromWindow(win) {
    const listener = this.#listeners.get(win);
    if (!listener) {
      return;
    }

    if (win.gBrowser) {
      try {
        win.gBrowser.removeProgressListener(listener);
      } catch (e) {
      }
    }

    this.#listeners.delete(win);
  }

  #onWindowOpen(aWindow, topic, _data) {
    if (topic !== "domwindowopened") {
      return;
    }

    const handler = (_event) => {
      if (aWindow.document.documentElement.getAttribute("windowtype") === "navigator:browser") {
        this.#attachToWindow(aWindow);
      }
    };

    aWindow.addEventListener("load", handler, { once: true });
  }

  #pauseLocked = false;

  pause(pauseLocked) {
    lazy.logger.debug("pause() called, pauseLocked=%s, #isPaused=%s", pauseLocked, this.#isPaused);

    if (pauseLocked) {
      this.#pauseLocked = true;
    }

    if (this.#isPaused) {
      return;
    }

    this.#isPaused = true;

    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      this.#attachToWindow(win);
    }

    this.#windowOpenListener = (subject, topic, data) => {
      this.#onWindowOpen(subject, topic, data);
    };
    Services.ww.registerNotification(this.#windowOpenListener);
  }

  unlockPause() {
    lazy.logger.debug("unlockPause() called, was #pauseLocked=%s", this.#pauseLocked);
    this.#pauseLocked = false;
  }

  resume() {
    lazy.logger.debug("resume() called, #isPaused=%s, #pauseLocked=%s", this.#isPaused, this.#pauseLocked);

    if (!this.#isPaused || this.#pauseLocked) {
      return;
    }

    this.#isPaused = false;

    if (this.#windowOpenListener) {
      Services.ww.unregisterNotification(this.#windowOpenListener);
      this.#windowOpenListener = null;
    }

    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      this.#detachFromWindow(win);
    }

    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (!win.gBrowser) {
        continue;
      }

      for (const tab of win.gBrowser.tabs) {
        if (!tab._cenoPaused) {
          continue;
        }

        const browser = tab.linkedBrowser;
        const url = tab._cenoResumeURL;

        try {
          if (url && url !== "about:blank") {
            browser.fixupAndLoadURIString(url, {
              triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
            });
          } else {
            win.gBrowser.reloadTabs([tab]);
          }
        } catch (e) {
          lazy.logger.error("Failed to resume tab: %s", e);
        }

        delete tab._cenoPaused;
        delete tab._cenoResumeURL;
      }
    }
  }
}

export const NavigationBlocker = new _NavigationBlocker();
