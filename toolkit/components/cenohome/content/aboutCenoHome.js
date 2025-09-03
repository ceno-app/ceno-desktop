// Keep CenoHomeStateName in sync with CenoHome.sys.mjs
const CenoHomeStateName = Object.freeze({
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

// Keep CenoHomeErrors in sync with CenoHome.sys.mjs
const CenoHomeErrors = Object.freeze({
  MissingOuinetBinary: "MissingOuinetBinary",
  MissingDataDir: "MissingDataDir",
  OuinetStartupError: "OuinetStartupError",
});

const CenoHomeErrorsL10n = Object.freeze({
  MissingOuinetBinary: "ceno-browser-about-ceno-home-error-missing-ouinet-binary",
  MissingDataDir: "ceno-browser-about-ceno-home-error-missing-ouinet-data-dir",
  OuinetStartupError: "ceno-browser-about-ceno-home-error-ouinet-startup",
});

/**
 * The controller for the about:cenohome page.
 */
class AboutCenoHome {
  selectors = Object.freeze({
    progress: {
      meter: "div#progressBar",
    },
    quickstart: {
      container: "div#quickstartContainer",
      toggle: "#quickstartToggle",
    },
    buttons: {
      cancel: "button#cancelButton",
      connect: "button#connectButton",
    },
    errorContainer: {
      linkStatus: "p#link-status",
      errors: "p#error-message",
    },
  });

  elements = Object.freeze({
    progressMeter: document.querySelector(this.selectors.progress.meter),
    quickstartContainer: document.querySelector(this.selectors.quickstart.container),
    quickstartToggle: document.querySelector(this.selectors.quickstart.toggle),
    cancelButton: document.querySelector(this.selectors.buttons.cancel),
    connectButton: document.querySelector(this.selectors.buttons.connect),
    tryAgainButton: document.querySelector(this.selectors.buttons.tryAgain),
    linkStatus: document.querySelector(this.selectors.errorContainer.linkStatus),
    errors: document.querySelector(this.selectors.errorContainer.errors),
  });

  /**
   * @type {CenoHomeState}
   */
  shownState = {
    name: CenoHomeStateName.Init,
    connectingToNetworkProgress: 0,
    error: null
  };

  /*
  Element helper methods
  */

  show(element) {
    element.removeAttribute("hidden");
  }

  hide(element) {
    element.setAttribute("hidden", "true");
  }

  updateQuickstart(enabled) {
    this.elements.quickstartToggle.pressed = enabled;
  }

  /**
   * Update the shown stage.
   *
   * @param {CenoHomeState} state - The new state to show.
   * @param {boolean} [focusConnect=false] - Whether to try and focus the
   *   connect button, if we are in the Start stage.
   */
  updateState(state, focusConnect = false) {
    if (
      state.name === this.shownState.name &&
      state.name != CenoHomeStateName.Init
    ) {
      return;
    }

    if (
      state.name === CenoHomeStateName.Init ||
      state.name === CenoHomeStateName.Exited ||
      state.name === CenoHomeStateName.Error
    ) {
      this.show(this.elements.quickstartContainer);
      this.hide(this.elements.cancelButton);
      this.show(this.elements.connectButton);
      this.hide(this.elements.progressMeter);

      if (
        state.name === CenoHomeStateName.Error &&
        state.error !== undefined &&
        CenoHomeErrorsL10n[state.error] !== undefined
      ) {
        document.l10n.setAttributes(this.elements.errors, CenoHomeErrorsL10n[state.error])
        this.show(this.elements.errors);
      } else {
        this.hide(this.elements.errors);
      }
    }
    else if (
      state.name === CenoHomeStateName.StartingProcess ||
      state.name === CenoHomeStateName.ConnectingToNetwork
    ) {
      this.show(this.elements.quickstartContainer);
      this.show(this.elements.cancelButton);
      this.hide(this.elements.connectButton);

      this.show(this.elements.progressMeter);
      this.elements.progressMeter.style.setProperty("--progress-percent", `${state.connectingToNetworkProgress}%`);

      this.hide(this.elements.errors);
    } else if (state.name === CenoHomeStateName.Connected) {
      this.hide(this.elements.quickstartContainer);
      this.hide(this.elements.cancelButton);
      this.hide(this.elements.connectButton);
      this.hide(this.elements.progressMeter);

      this.hide(this.elements.errors);
    }

    this.shownState = state;

    if (focusConnect && state.name === CenoHomeStateName.Init) {
      this.elements.connectButton.focus();
    }
  }

  initElements(direction) {
    const isAndroid = navigator.userAgent.includes("Android");
    document.body.classList.toggle("android", isAndroid);

    document.documentElement.setAttribute("dir", direction);

    this.elements.quickstartToggle.addEventListener("toggle", () => {
      const quickstart = this.elements.quickstartToggle.pressed;
      RPMSendAsyncMessage("cenohome:set-quickstart", quickstart);
    });

    this.elements.connectButton.addEventListener("click", () => {
      RPMSendAsyncMessage("cenohome:connect");
    });

    this.elements.cancelButton.addEventListener("click", () => {
      RPMSendAsyncMessage("cenohome:cancel");
    });

    // Prevent repeat triggering on keydown when the Enter key is held down.
    //
    // Without this, holding down Enter will continue to trigger the button's
    // click event until the user stops holding. This means that a user can
    // accidentally re-trigger a button several times. And if focus moves to a
    // new button it can also get triggered, despite not receiving the initial
    // keydown event.
    //
    // E.g. If the user presses down Enter on the "Connect" button it will
    // trigger and focus will move to the "Cancel" button. This should prevent
    // the user accidentally triggering the "Cancel" button if they hold down
    // Enter for a little bit too long.
    for (const button of document.body.querySelectorAll("button")) {
      button.addEventListener("keydown", event => {
        // If the keydown is a repeating Enter event, ignore it.
        // NOTE: If firefox uses wayland display (rather than xwayland), the
        // "repeat" event is always "false" so this will not work.
        // See bugzilla bug 1784438. Also see bugzilla bug 1594003.
        // Currently tor browser uses xwayland by default on linux.
        if (event.key === "Enter" && event.repeat) {
          event.preventDefault();
        }
      });
    }

    this.show(this.elements.quickstartContainer);
    this.hide(this.elements.cancelButton);
    this.show(this.elements.connectButton);
    this.hide(this.elements.progressMeter);

    this.hide(this.elements.errors);
    this.hide(this.elements.linkStatus);
  }

  initObservers() {
    RPMAddMessageListener("cenohome:state-change", ( {data} ) => {
      this.updateState(data);
    });
    RPMAddMessageListener("cenohome:quickstart-change", ({ data }) => {
      this.updateQuickstart(data);
    });
    RPMAddMessageListener("cenohome:internet-status-change", ({ data }) => {
      console.log("received cenohome:internet-status-change", data);
      if (data.internetStatus === 1) {
        this.hide(this.elements.linkStatus);
      } else {
        this.show(this.elements.linkStatus);
      }
    });
  }

  initKeyboardShortcuts() {
    document.onkeydown = evt => {
      // unfortunately it looks like we still haven't standardized keycodes to
      // integers, so we must resort to a string compare here :(
      // see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code for relevant documentation
      if (evt.code === "Escape") {
        if (
          this.shownState.name === CenoHomeStateName.StartingProcess ||
          this.shownState.name === CenoHomeStateName.ConnectingToNetwork
        ) {
          RPMSendAsyncMessage("cenohome:cancel");
        }
      }
    };
  }

  async init() {
    let args = await RPMSendQuery("cenohome:get-init-args");

    this.initElements(args.Direction);
    this.initObservers();
    this.initKeyboardShortcuts();

    // If we have previously opened about:cenohome and the user tried the
    // "Connect" button we want to focus the "Connect" button for easy
    // activation.
    // Otherwise, we do not want to focus it for first time users so they can
    // read the full page first.
    const focusConnect = args.userHasEverClickedConnect;

    this.updateState(args.state, focusConnect);
    this.updateQuickstart(args.quickstartEnabled);
  }
}

const aboutCenoHome = new AboutCenoHome();
aboutCenoHome.init();
