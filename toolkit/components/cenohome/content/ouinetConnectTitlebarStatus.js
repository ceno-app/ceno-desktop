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

  #iconNotConnected = null;
  #iconConnected = null;

  /**
   * Initialize the component.
   */
  init() {
    this.#node = document.getElementById("ouinet-connect-titlebar-status");
    this.#label = document.getElementById("ouinet-connect-titlebar-status-label");
    this.#iconNotConnected = document.getElementById("ouinet-connect-titlebar-status-icon-not-connected");
    this.#iconConnected = document.getElementById("ouinet-connect-titlebar-status-icon-connected");

    // The title also acts as an accessible name for the role="status".
    // @TODO: figure out how to set this l10n value through markup.
    document.l10n.formatValue('ceno-browser-ouinet-titlebar-status-name').then((title) => {
      this.#node.setAttribute('title', title);
    });

    this.#observeTopic = CenoNetworkTopics.StateChange;
    this.#stateListener = {
      observe: (subject, topic) => {
        if (topic !== this.#observeTopic) {
          return;
        }
        this.#stateChanged(subject?.wrappedJSObject?.ouinetStage);
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
   * Callback for when the CenoNetwork state changes.
   */
  #stateChanged(ouinetStage) {
    if (!ouinetStage) {
      ouinetStage = CenoNetwork.CenoNetworkState().ouinetStage;
    }
    let textId;
    let connected = false;
    switch (ouinetStage) {
      case OuinetStages.Connected:
        textId = 'ceno-browser-ouinet-titlebar-status-connected';
        connected = true;
        break;
      case OuinetStages.Degraded:
        textId = 'ceno-browser-ouinet-titlebar-status-degraded';
        break;
      case OuinetStages.StartingProcess:
      case OuinetStages.ConnectingToNetwork:
        textId = 'ceno-browser-ouinet-titlebar-status-connecting';
        break;
      case OuinetStages.Init:
      case OuinetStages.Exited:
      case OuinetStages.Error:
      default:
        textId = 'ceno-browser-ouinet-titlebar-status-not-connected';
        break;
    }
    document.l10n.setAttributes(this.#label, textId);

    if (this.#connected !== connected) {
      this.#node.classList.toggle("ouinet-connect-status-connected", connected);
      this.#connected = connected;
      if (connected) {
        this.#startHiding();

        this.#iconNotConnected.hidden = true;
        this.#iconConnected.hidden = false;
      } else {
        // We can leave the connected state when we are no longer Bootstrapped
        // because the underlying ouinet process exited early and needs a
        // restart. In this case we want to re-show the status.
        this.#stopHiding();

        this.#iconConnected.hidden = true;
        this.#iconNotConnected.hidden = false;
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
