// Taken from TorConnectTitlebarStatus

/**
 * A OuinetConnect status shown in the application title bar.
 */
class OuinetConnectTitlebarStatus {
  /**
   * The status element in the title bar.
   *
   * @type {Element}
   */
  #node = null;
  /**
   * The status label.
   *
   * @type {Element}
   */
  #label = null;
  /**
   * Whether we are connected, or null if the connection state is not yet known.
   *
   * @type {bool?}
   */
  #connected = null;

  #observeTopic = null;
  #stateListener = null;

  /**
   * Initialize the component.
   */
  init() {
    this.#node = document.getElementById("ouinet-connect-titlebar-status");
    this.#label = document.getElementById("ouinet-connect-titlebar-status-label");

    // The title also acts as an accessible name for the role="status".
    // @TODO: figure out how to set this l10n value through markup.
    document.l10n.formatValue('ceno-browser-ouinet-titlebar-status-name').then((title) => {
      this.#node.setAttribute('title', title);
    });

    this.#observeTopic = CenoHomeTopics.StateChange;
    this.#stateListener = {
      observe: (_subject, topic) => {
        if (topic !== this.#observeTopic) {
          return;
        }
        this.#stateChanged();
      },
    };
    Services.obs.addObserver(this.#stateListener, this.#observeTopic);

    this.#stateChanged();
  }

  /**
   * De-initialize the component.
   */
  uninit() {
    Services.obs.removeObserver(this.#stateListener, this.#observeTopic);
  }

  /**
   * Callback for when the CenoHome state changes.
   */
  #stateChanged() {
    let textId;
    let connected = false;
    switch (CenoHome.state.name) {
      case CenoHomeStateName.Connected:
        textId = 'ceno-browser-ouinet-titlebar-status-connected';
        connected = true;
        break;
      case CenoHomeStateName.StartingProcess:
      case CenoHomeStateName.ConnectingToNetwork:
        textId = 'ceno-browser-ouinet-titlebar-status-connecting';
        break;
      case CenoHomeStateName.Init:
      case CenoHomeStateName.Exited:
      case CenoHomeStateName.Error:
      default:
        textId = 'ceno-browser-ouinet-titlebar-status-not-connected';
        break;
    }
    document.l10n.setAttributes(this.#label, textId);

    if (this.#connected !== connected) {
      // When we are transitioning from
      //   this.connected = false
      // to
      //   this.connected = true
      // we want to animate the transition from the not connected state to the
      // connected state (provided prefers-reduced-motion is not set).
      //
      // If instead we are transitioning directly from the initial state
      //   this.connected = null
      // to
      //   this.connected = true
      // we want to immediately show the connected state without any transition.
      //
      // In both cases, the status will eventually be hidden.
      //
      // We only expect this latter case when opening a new window after
      // bootstrapping has already completed. See tor-browser#41850.
      this.#node.classList.toggle(
        "ouinet-connect-status-animate-transition",
        connected && this.#connected !== null
      );
      this.#node.classList.toggle("ouinet-connect-status-connected", connected);
      this.#connected = connected;
      if (connected) {
        this.#startHiding();
      } else {
        // We can leave the connected state when we are no longer Bootstrapped
        // because the underlying ouinet process exited early and needs a
        // restart. In this case we want to re-show the status.
        this.#stopHiding();
      }
    }
  }

  #hidingTimeout = null;
  /**
   * Mark the component to be hidden after some delay.
   */
  #startHiding() {
    if (this.#hidingTimeout) {
      // Already hiding.
      return;
    }
    this.#hidingTimeout = setTimeout(() => {
      this.#node.hidden = true;
    }, 5000);
  }

  /**
   * Re-show the component immediately.
   */
  #stopHiding() {
    if (this.#hidingTimeout) {
      clearTimeout(this.#hidingTimeout);
      this.#hidingTimeout = 0;
    }
    this.#node.hidden = false;
  }
};

var gOuinetConnectTitlebarStatus = new OuinetConnectTitlebarStatus();

// var gOuinetConnectTitlebarStatus = {
//   init() {
//     console.log("HELLO!!!");
//   },
// };
