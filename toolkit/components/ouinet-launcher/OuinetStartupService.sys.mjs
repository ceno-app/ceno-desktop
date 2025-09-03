const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  CenoHome: "resource://gre/modules/CenoHome.sys.mjs",
});

const BrowserTopics = Object.freeze({
  ProfileAfterChange: "profile-after-change",
  QuitApplicationGranted: "quit-application-granted",
});

/**
 * This class is registered as an observer, and will be instanced automatically
 * by Firefox.
 * When it observes profile-after-change, it initializes whatever is needed to
 * launch Ouinet.
 */
export class OuinetStartupService {
  #gInited = false;

  observe(aSubject, aTopic) {
    if (aTopic === BrowserTopics.ProfileAfterChange && !this.#gInited) {
      this.#init();
    } else if (aTopic === BrowserTopics.QuitApplicationGranted) {
      this.#uninit();
    }
  }

  #init() {
    Services.obs.addObserver(this, BrowserTopics.QuitApplicationGranted);
    lazy.CenoHome.init();
    this.#gInited = true;
  }

  #uninit() {
    Services.obs.removeObserver(this, BrowserTopics.QuitApplicationGranted);
    lazy.CenoHome.uninit();
  }
}
