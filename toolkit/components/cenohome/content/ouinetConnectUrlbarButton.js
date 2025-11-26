/* eslint-env mozilla/browser-window */

// Taken from torConnectUrlbarButton.js

/**
 * A "Connect" button shown in the urlbar when not connected to ouinet and in tabs
 * other than about:cenohome.
 */
class OuinetConnectUrlbarButton {
  /**
   * The urlbar button node.
   *
   * @type {Element}
   */
  #button = null;
  /**
   * Whether we are active.
   *
   * @type {boolean}
   */
  #isActive = false;
  /**
   * Whether we are in the "about:cenohome" tab.
   *
   * @type {boolean}
   */
  // We init to "true" so that the button can only appear after the first page
  // load.
  #inAboutCenoHomeTab = true;

  #observeTopic = null;
  #stateListener = null;
  #locationListener = null;

  /**
   * Initialize the button.
   */
  init() {
    try {
    if (this.#isActive) {
      return;
    }

    this.#button = document.getElementById("ouinet-connect-urlbar-button");

    this.#isActive = true;

    this.#button.addEventListener("click", event => {
      if (event.button !== 0) {
        return;
      }
      this.connect();
    });
    this.#button.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      this.connect();
    });

    this.#observeTopic = CenoNetworkTopics.StateChange;
    this.#stateListener = {
      observe: (subject, topic) => {
        if (topic !== this.#observeTopic) {
          return;
        }
        this.#updateButtonVisibility(subject?.wrappedJSObject?.ouinetStage);
      },
    };
    Services.obs.addObserver(this.#stateListener, this.#observeTopic);

    this.#locationListener = {
      onLocationChange: (webProgress, _request, _locationURI, flags) => {
        if (
          webProgress.isTopLevel &&
          !(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)
        ) {
          this.#inAboutCenoHomeTab =
            gBrowser.selectedBrowser.currentURI?.spec.startsWith(
              "about:cenohome"
            );
          this.#updateButtonVisibility();
        }
      },
    };
    // Notified of new locations for the currently selected browser (tab) *and*
    // switching selected browser.
    gBrowser.addProgressListener(this.#locationListener);

    this.#updateButtonVisibility();
    } catch (e) {
      console.log(e);
    }
  }

  /**
   * Deactivate and de-initialize the button.
   */
  uninit() {
    if (!this.#isActive) {
      return;
    }
    this.#isActive = false;

    Services.obs.removeObserver(this.#stateListener, this.#observeTopic);
    gBrowser.removeProgressListener(this.#locationListener);
    this.#updateButtonVisibility();
  }

  /**
   * Begin the tor connection bootstrapping process.
   */
  connect() {
    CenoNetwork.connect();
  }

  /**
   * Callback when the TorConnect state, current browser location, or activation
   * state changes.
   */
  #updateButtonVisibility(ouinetStage) {
    if (!ouinetStage) {
      ouinetStage = CenoNetwork.CenoNetworkState().ouinetStage;
    }
    if (!this.#button) {
      return;
    }
    const hadFocus = this.#button.contains(document.activeElement);
    const hide =
      !this.#isActive ||
      this.#inAboutCenoHomeTab ||
      ouinetStage === OuinetStages.Connected ||
      ouinetStage === OuinetStages.Degraded ||
      ouinetStage === OuinetStages.OuinetStages ||
      ouinetStage === OuinetStages.StartingProcess;
    this.#button.hidden = hide;
    if (hide && hadFocus) {
      // Lost focus. E.g. if the "Connect" button is focused in another window
      // or tab outside of about:cenohome.
      // Move focus back to the URL bar.
      gURLBar.focus();
    }
  }
};

var gOuinetConnectUrlbarButton = new OuinetConnectUrlbarButton();
