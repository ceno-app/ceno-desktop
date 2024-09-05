// Copyright (c) 2024, eQualitie
// See LICENSE for licensing information.

/*************************************************************************
 * Ceno Launcher Util JS Module
 *************************************************************************/

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};

XPCOMUtils.defineLazyServiceGetters(lazy, {
  gCertDB: ["@mozilla.org/security/x509certdb;1", "nsIX509CertDB"],
});

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

const PREF_LOGLEVEL = "browser.policies.loglevel";

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  let { ConsoleAPI } = ChromeUtils.importESModule(
    "resource://gre/modules/Console.sys.mjs"
  );
  return new ConsoleAPI({
    prefix: "CenoLauncherUtil",
    // tip: set maxLogLevel to "debug" and use log.debug() to create detailed
    // messages during development. See LOG_LEVELS in Console.sys.mjs for details.
    maxLogLevel: "error",
    maxLogLevelPref: PREF_LOGLEVEL,
  });
});

class CenoFile {
  // The nsIFile to be returned
  file = null;

  isIPC = false;
  ipcFileName = "";
  checkIPCPathLen = true;

  static _isFirstIPCPathRequest = true;
  static _dataDir = null;
  static _appDir = null;
  static _cenoDir = null;

  constructor(aCenoFileType, aCreate) {
    this.fileType = aCenoFileType;

    this.getFromPref();
    // No preference; use a default path.
    if (!this.file) {
      this.getDefault();
    }
    // At this point, this.file must not be null, or previous functions must
    // have thrown and interrupted this constructor.
    if (!this.file.exists() && aCreate) {
      this.createFile();
    }
    //this.normalize();
  }

  getFile() {
    return this.file;
  }

  getFromPref() {
    const prefName = `extensions.cenolauncher.${this.fileType}_path`;
    const path = Services.prefs.getCharPref(prefName, "");
    if (path) {
      const isUserData =
        this.fileType !== "client" &&
        this.fileType !== "startup-dir";
      // always try to use path if provided in pref
      this.checkIPCPathLen = false;
      this.setFileFromPath(path, isUserData);
    }
  }

  getDefault() {
    switch (this.fileType) {
      case "client":
        this.file = CenoFile.cenoDir;
        this.file.append(CenoLauncherUtil.isWindows ? "client.exe" : "client");
        break;
      case "repos-client":
        this.file = CenoFile.cenoDir;
        this.file.append("repos");
        this.file.append("client");
        break;
      case "cacert":
        this.file = CenoFile.cenoDir;
        this.file.append("repos");
        this.file.append("client");
        this.file.append("ssl-ca-cert.pem");
        break;
      case "startup-dir":
        // On macOS we specify different relative paths than on Linux and
        // Windows
        this.file = CenoLauncherUtil.isMac ? CenoFile.cenoDir : CenoFile.appDir;
        break;
      default:
        throw new Error("Unknown file type");
    }
  }

  // This function is used to set this.file from a string that contains a path.
  // As a matter of fact, it is used only when setting a path from preferences,
  // or to set the default IPC paths.
  setFileFromPath(path, isUserData) {
    if (CenoLauncherUtil.isWindows) {
      path = path.replaceAll("/", "\\");
    }
    // Turn 'path' into an absolute path when needed.
    if (CenoLauncherUtil.isPathRelative(path)) {
      if (CenoLauncherUtil.isMac) {
        // On macOS, files are correctly separated because it was needed for the
        // gatekeeper signing.
        this.file = isUserData ? CenoFile.dataDir : CenoFile.appDir;
      } else {
        // Windows and Linux still use the legacy behavior.
        // To avoid breaking old installations, let's just keep it.
        this.file = CenoFile.appDir;
        this.file.append("CenoBrowser");
      }
      this.file.appendRelativePath(path);
    } else {
      this.file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      this.file.initWithPath(path);
    }
  }

  createFile() {
    /*
    // Example of creating directories
    if (
      "datadir" == this.fileType ||
      "authdir" == this.fileType ||
      "profiles-dir" == this.fileType
    ) {
      this.file.create(this.file.DIRECTORY_TYPE, 0o700);
    } else {
    */
      this.file.create(this.file.NORMAL_FILE_TYPE, 0o600);
    //}
  }

  // Returns an nsIFile that points to the binary directory (on Linux and
  // Windows), and to the root of the application bundle on macOS.
  static get appDir() {
    if (!this._appDir) {
      // .../CenoBrowser on Windows and Linux, .../CenoBrowser.app/Contents/MacOS/ on
      // macOS.
      this._appDir = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent;
      if (CenoLauncherUtil.isMac) {
        this._appDir = this._appDir.parent.parent;
      }
    }
    return this._appDir.clone();
  }

  // Returns an nsIFile that points to the data directory. This is usually
  // CenoBrowser/Data/ on Linux and Windows, and CenoBrowser-Data/ on macOS.
  // The parent directory of the default profile directory is taken.
  static get dataDir() {
    if (!this._dataDir) {
      // Notice that we use `DefProfRt`, because users could create their
      // profile in a completely unexpected directory: the profiles.ini contains
      // a IsRelative entry, which I expect could influence ProfD, but not this.
      this._dataDir = Services.dirsvc.get("DefProfRt", Ci.nsIFile).parent;
    }
    return this._dataDir.clone();
  }

  // Returns an nsIFile that points to the directory that contains the ouinet
  // client executable.
  static get cenoDir() {
    if (!this._cenoDir) {
      // The directory that contains firefox
      const cenoDir = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent;
      if (!CenoLauncherUtil.isMac) {
        cenoDir.append("ouinet");
      }
      cenoDir.append("build");
      // Save the value only if the XPCOM methods do not throw.
      this._cenoDir = cenoDir;
    }
    return this._cenoDir.clone();
  }

  // Returns an nsIFile that points to the directory that contains the ceno
  // data. Currently it is ${dataDir}/Ceno.
  static get cenoDataDir() {
    const dir = this.dataDir;
    dir.append("Ceno");
    return dir;
  }
}

export const CenoLauncherUtil = Object.freeze({
  get isAndroid() {
    return Services.appinfo.OS === "Android";
  },

  get isMac() {
    return Services.appinfo.OS === "Darwin";
  },

  get isWindows() {
    return Services.appinfo.OS === "WINNT";
  },

  isPathRelative(path) {
    const re = this.isWindows ? /^([A-Za-z]:|\\)\\/ : /^\//;
    return !re.test(path);
  },

  // TODO: Remove? Can we control the proxy config with Ceno extension
  setProxyConfiguration() {
    Services.prefs.setCharPref("network.proxy.http", "127.0.0.1");
    Services.prefs.setIntPref("network.proxy.http_port", 8077);
    Services.prefs.setCharPref("network.proxy.ssl", "127.0.0.1");
    Services.prefs.setIntPref("network.proxy.ssl_port", 8077);
    Services.prefs.setIntPref("network.proxy.type", 1);

    // Force prefs to be synced to disk
    Services.prefs.savePrefFile(null);
  },

  get shouldStartAndOwnCeno() {
    const kPrefStartCeno = "extensions.cenolauncher.start_ouinet";
    try {
      const kBrowserToolboxPort = "MOZ_BROWSER_TOOLBOX_PORT";
      const kEnvSkipLaunch = "CENO_SKIP_LAUNCH";
      const kEnvProvider = "CENO_PROVIDER";
      if (Services.env.exists(kBrowserToolboxPort)) {
        return false;
      }
      if (Services.env.exists(kEnvSkipLaunch)) {
        const value = parseInt(Services.env.get(kEnvSkipLaunch));
        return isNaN(value) || !value;
      }
      if (
        Services.env.exists(kEnvProvider) &&
        Services.env.get(kEnvProvider) === "none"
      ) {
        return false;
      }
    } catch (e) {}
    return Services.prefs.getBoolPref(kPrefStartCeno, true);
  },

  setRootCertificate() {
    (async () => {
      let dirs = [];
      let platform = AppConstants.platform;
      if (platform == "win") {
        dirs = [
          // Ugly, but there is no official way to get %USERNAME\AppData\Roaming\Mozilla.
          Services.dirsvc.get("XREUSysExt", Ci.nsIFile).parent,
          // Even more ugly, but there is no official way to get %USERNAME\AppData\Local\Mozilla.
          Services.dirsvc.get("DefProfLRt", Ci.nsIFile).parent.parent,
        ];
      } else if (platform == "macosx" || platform == "linux") {
        dirs = [
          // These two keys are named wrong. They return the Mozilla directory.
          Services.dirsvc.get("XREUserNativeManifests", Ci.nsIFile),
          Services.dirsvc.get("XRESysNativeManifests", Ci.nsIFile),
        ];
      }
      dirs.unshift(Services.dirsvc.get("XREAppDist", Ci.nsIFile));

        let certfilename = CenoLauncherUtil.getCenoFile("cacert", false).path 
        let certfile
        try {
          certfile = Cc["@mozilla.org/file/local;1"].createInstance(
            Ci.nsIFile
          );
          certfile.initWithPath(certfilename);
        } catch (e) {
          for (let dir of dirs) {
            certfile = dir.clone();
            certfile.append(
              platform == "linux" ? "certificates" : "Certificates"
            );
            certfile.append(certfilename);
            if (certfile.exists()) {
              break;
            }
          }
        }
        let file;
        try {
          file = await File.createFromNsIFile(certfile);
        } catch (e) {
          lazy.log.error(`Unable to find certificate - ${certfilename}`);
          return;
        }
        let reader = new FileReader();
        reader.onloadend = function () {
          if (reader.readyState != reader.DONE) {
            lazy.log.error(`Unable to read certificate - ${certfile.path}`);
            return;
          }
          let certFile = reader.result;
          let certFileArray = [];
          for (let i = 0; i < certFile.length; i++) {
            certFileArray.push(certFile.charCodeAt(i));
          }
          let cert;
          try {
            cert = lazy.gCertDB.constructX509(certFileArray);
          } catch (e) {
            lazy.log.debug(
              `constructX509 failed with error '${e}' - trying constructX509FromBase64.`
            );
            try {
              // It might be PEM instead of DER.
              cert = lazy.gCertDB.constructX509FromBase64(
                pemToBase64(certFile)
              );
            } catch (ex) {
              lazy.log.error(
                `Unable to add certificate - ${certfile.path}`,
                ex
              );
            }
          }
          if (cert) {
            if (
              lazy.gCertDB.isCertTrusted(
                cert,
                Ci.nsIX509Cert.CA_CERT,
                Ci.nsIX509CertDB.TRUSTED_SSL
              )
            ) {
              // Certificate is already installed.
              return;
            }
            try {
              lazy.gCertDB.addCert(certFile, "CT,CT,");
            } catch (e) {
              // It might be PEM instead of DER.
              lazy.gCertDB.addCertFromBase64(
                pemToBase64(certFile),
                "CT,CT,"
              );
            }
          }
        };
        reader.readAsBinaryString(file);
    })();
  },

  // Source: https://superuser.com/questions/1669675/enable-all-firefox-extensions-in-private-mode-by-default
  setExtensionPermissions() {
    (async()=>{
      const PRIVATE_BROWSING_PERMS = {
          permissions: ["internal:privateBrowsingAllowed"],
          origins: [],
      };
      const {ExtensionPermissions} = ChromeUtils.import("resource://gre/modules/ExtensionPermissions.jsm");
      const myaddons = await lazy.AddonManager.getAddonsByTypes(["extension"]);
      for(let addon of myaddons){
        if (addon.id == "ceno@equalit.ie") {
          lazy.log.debug(
            `Setting permissions on '${addon.id}'.`
          );
          let policy = WebExtensionPolicy.getByID(addon.id);
          let extension = policy && policy.extension;
          await ExtensionPermissions.add(addon.id, PRIVATE_BROWSING_PERMS, extension);
          if (addon.isActive)
              addon.reload();
        }
      }
  })();
  },

  // Returns an nsIFile.
  // If aCenoFileType is "control_ipc" or "socks_ipc", aCreate is ignored
  // and there is no requirement that the IPC object exists.
  // For all other file types, null is returned if the file does not exist
  // and it cannot be created (it will be created if aCreate is true).
  getCenoFile(aCenoFileType, aCreate) {
    if (!aCenoFileType) {
      return null;
    }
    try {
      const cenoFile = new CenoFile(aCenoFileType, aCreate);
      return cenoFile.getFile();
    } catch (e) {
      console.error(`getCenoFile: cannot get ${aCenoFileType}`, e);
    }
    return null; // File not found or error (logged above).
  },

});

function pemToBase64(pem) {
  return pem
    .replace(/(.*)-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----(.*)/, "")
    .replace(/[\r\n]/g, "");
}
