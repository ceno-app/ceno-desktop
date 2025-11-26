// Keep OuinetStages in sync with CenoNetwork.sys.mjs
const OuinetStages = Object.freeze({
  Init: "Init",
  StartingProcess: "StartingProcess",
  ConnectingToNetwork: "ConnectingToNetwork",
  Connected: "Connected",
  Degraded: "Degraded",
  Exited: "Exited",
  Error: "Error",
});

// Keep CenoNetworkTopics in sync with CenoNetwork.sys.mjs
const CenoNetworkTopics = Object.freeze({
  StateChange: "cenonetwork:state-change",
  Connect: "cenonetwork:connect",
  Cancel: "cenonetwork:cancel",
  SetQuickstart: "cenonetwork:set-quickstart",
});

// Keep CenoNetworkErrors in sync with CenoNetwork.sys.mjs
const CenoNetworkErrors = Object.freeze({
  MissingOuinetBinary: "MissingOuinetBinary",
  MissingDataDir: "MissingDataDir",
  OuinetStartupError: "OuinetStartupError",
});
// Keep CenoNetworkErrorToL10n in sync with CenoNetwork.sys.mjs
function CenoNetworkErrorToL10n(error) {
  switch (error) {
    case CenoNetworkErrors.MissingOuinetBinary:
      return "ceno-browser-about-ceno-home-error-missing-ouinet-binary";
    case MissingDataDir:
      return "ceno-browser-about-ceno-home-error-missing-ouinet-data-dir";
    case OuinetStartupError:
      return "ceno-browser-about-ceno-home-error-ouinet-startup";
  }
}

// Keep InternetStatus in sync with CenoNetwork.sys.mjs
const InternetStatus = Object.freeze({
  Unknown: -1,
  Offline: 0,
  Online: 1,
});

function ouinetStageToConnectionProgress(ouinetStage) {
  let connectingToNetworkProgress = 0;
  if (ouinetStage === OuinetStages.StartingProcess) {
    connectingToNetworkProgress = 1;
  } else if (ouinetStage === OuinetStages.ConnectingToNetwork) {
    connectingToNetworkProgress = 33;
  } else if (ouinetStage === OuinetStages.Degraded) {
    connectingToNetworkProgress = 66;
  } else if (ouinetStage === OuinetStages.Connected) {
    connectingToNetworkProgress = 100;
  }
  return connectingToNetworkProgress;
}

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

  shownState = OuinetStages.Init;

  /*
  Element helper methods
  */

  show(element) {
    element.removeAttribute("hidden");
  }

  hide(element) {
    element.setAttribute("hidden", "true");
  }

  updateState(state, focusConnect = false) {
    this.elements.quickstartToggle.pressed = state.quickstart;

    if (state.internetStatus === InternetStatus.Online) {
      this.hide(this.elements.linkStatus);
    } else {
      this.show(this.elements.linkStatus);
    }

    if (
      state.ouinetStage === OuinetStages.Init ||
      state.ouinetStage === OuinetStages.Exited ||
      state.ouinetStage === OuinetStages.Error
    ) {
      this.show(this.elements.quickstartContainer);
      this.hide(this.elements.cancelButton);
      this.show(this.elements.connectButton);
      this.hide(this.elements.progressMeter);

      if (
        state.ouinetStage === OuinetStages.Error &&
        state.error !== undefined &&
        CenoNetworkErrorToL10n[state.error] !== undefined
      ) {
        document.l10n.setAttributes(this.elements.errors, CenoNetworkErrorToL10n[state.error])
        this.show(this.elements.errors);
      } else {
        this.hide(this.elements.errors);
      }
    }
    else if (
      state.ouinetStage === OuinetStages.StartingProcess ||
      state.ouinetStage === OuinetStages.ConnectingToNetwork ||
      state.ouinetStage === OuinetStages.Degraded
    ) {
      this.show(this.elements.quickstartContainer);
      this.show(this.elements.cancelButton);
      this.hide(this.elements.connectButton);

      this.show(this.elements.progressMeter);
      const percentage = ouinetStageToConnectionProgress(state.ouinetStage);
      this.elements.progressMeter.style.setProperty("--progress-percent", `${percentage}%`);

      this.hide(this.elements.errors);
    } else if (state.ouinetStage === OuinetStages.Connected) {
      this.hide(this.elements.quickstartContainer);
      this.hide(this.elements.cancelButton);
      this.hide(this.elements.connectButton);
      this.hide(this.elements.progressMeter);

      this.hide(this.elements.errors);
    }

    this.shownState = state;

    if (focusConnect && state.ouinetStage === OuinetStages.Init) {
      this.elements.connectButton.focus();
    }
  }

  initElements(direction) {
    const isAndroid = navigator.userAgent.includes("Android");
    document.body.classList.toggle("android", isAndroid);

    document.documentElement.setAttribute("dir", direction);

    this.elements.quickstartToggle.addEventListener("toggle", () => {
      const quickstart = this.elements.quickstartToggle.pressed;
      RPMSendAsyncMessage(CenoNetworkTopics.SetQuickstart, quickstart);
    });

    this.elements.connectButton.addEventListener("click", () => {
      RPMSendAsyncMessage(CenoNetworkTopics.Connect);
    });

    this.elements.cancelButton.addEventListener("click", () => {
      RPMSendAsyncMessage(CenoNetworkTopics.Cancel);
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
    RPMAddMessageListener(CenoNetworkTopics.StateChange, ({data}) => {
      this.updateState(data);
    });
  }

  initKeyboardShortcuts() {
    document.onkeydown = evt => {
      // unfortunately it looks like we still haven't standardized keycodes to
      // integers, so we must resort to a string compare here :(
      // see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code for relevant documentation
      if (evt.code === "Escape") {
        if (
          this.shownState === OuinetStages.StartingProcess ||
          this.shownState === OuinetStages.Degraded ||
          this.shownState === OuinetStages.ConnectingToNetwork
        ) {
          RPMSendAsyncMessage(CenoNetworkTopics.Cancel);
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
  }
}

const aboutCenoHome = new AboutCenoHome();
aboutCenoHome.init();
