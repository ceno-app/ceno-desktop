const lazy = {};

// We will use the modules only when the profile is loaded, so prefer lazy
// loading
ChromeUtils.defineESModuleGetters(lazy, {
  OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
  OuinetProviderBuilder: "resource://gre/modules/OuinetProviderBuilder.sys.mjs",
});

/* Browser observer topics */
const BrowserTopics = Object.freeze({
  ProfileAfterChange: "profile-after-change",
  QuitApplicationGranted: "quit-application-granted",
});

let gInited = false;

// This class is registered as an observer, and will be instanced automatically
// by Firefox.
// When it observes profile-after-change, it initializes whatever is needed to
// launch Ouinet client.
export class OuinetStartupService {
  observe(aSubject, aTopic, aData) {
    if (aTopic === BrowserTopics.ProfileAfterChange && !gInited) {
      this.#init();
    } else if (aTopic === BrowserTopics.QuitApplicationGranted) {
      this.#uninit();
    }
  }

  async #init() {
    Services.obs.addObserver(this, BrowserTopics.QuitApplicationGranted);

    // Do not await on this init. build() is expected to await the
    // initialization, so anything that should need the Ouinet Provider should
    // block there, instead.
    lazy.OuinetProviderBuilder.init();
    gInited = true;
  }

  #uninit() {
    Services.obs.removeObserver(this, BrowserTopics.QuitApplicationGranted);
    lazy.OuinetProviderBuilder.uninit();
  }
}
