const lazy = {};

// We will use the modules only when the profile is loaded, so prefer lazy
// loading
ChromeUtils.defineESModuleGetters(lazy, {
  CenoLauncherUtil: "resource://gre/modules/CenoLauncherUtil.sys.mjs",
  CenoProviderBuilder: "resource://gre/modules/CenoProviderBuilder.sys.mjs",
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
export class CenoStartupService {
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
    // initialization, so anything that should need the Ceno Provider should
    // block there, instead.
    lazy.CenoProviderBuilder.init();
    gInited = true;
  }

  #uninit() {
    Services.obs.removeObserver(this, BrowserTopics.QuitApplicationGranted);
    lazy.CenoProviderBuilder.uninit();
  }
}
