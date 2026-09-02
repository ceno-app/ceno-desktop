// Copyright (c) 2024, eQualitie
// See LICENSE for licensing information.

/*************************************************************************
 * Ouinet Launcher Util JS Module
 *************************************************************************/

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};

XPCOMUtils.defineLazyServiceGetters(lazy, {
  gCertDB: ["@mozilla.org/security/x509certdb;1", "nsIX509CertDB"],
});

ChromeUtils.defineESModuleGetters(lazy, {
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

const prefs_prefix = "extensions.ouinetlauncher";

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  return console.createInstance({
    maxLogLevelPref: "ceno.browser.log_level",
    prefix: "OuinetProcess",
  });
});

class OuinetFile {
  // The nsIFile to be returned
  file = null;

  isIPC = false;
  ipcFileName = "";
  checkIPCPathLen = true;

  static _isFirstIPCPathRequest = true;
  static _dataDir = null;
  static _appDir = null;
  static _ouinetDir = null;

  constructor(aOuinetFileType, aCreate) {
    this.fileType = aOuinetFileType;

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
  }

  getFile() {
    return this.file;
  }

  getFromPref() {
    const prefName = `${prefs_prefix}.${this.fileType}_path`;
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
        this.file = OuinetFile.ouinetDir;
        this.file.append(OuinetLauncherUtil.isWindows ? "ceno-network-client.exe" : "client");
        break;
      case "client-firewall-allow":
        if (!OuinetLauncherUtil.isWindows) {
          throw new Error("client-firewall-allow is available only on windows");
        }
        this.file = OuinetFile.ouinetDir;
        this.file.append("ceno-network-client-firewall-allow.exe");
        break;
      case "repo":
        this.file = OuinetFile.ouinetDataDir;
        break;
      case "conf":
        this.file = OuinetFile.ouinetDataDir;
        this.file.append("ouinet-client.conf");
        break;
      case "cacert":
        this.file = OuinetFile.ouinetDataDir;
        this.file.append("ssl-ca-cert.pem");
        break;
      case "injcert":
        this.file = OuinetFile.ouinetDir;
        this.file.append("ssl-inj-cert.pem");
        break;
      case "mozcert":
        this.file = OuinetFile.ouinetDir;
        this.file.append("cacert.pem");
        break;
      case "startup-dir":
        // On macOS we specify different relative paths than on Linux and
        // Windows
        this.file = OuinetLauncherUtil.isMac ? OuinetFile.ouinetDir : OuinetFile.appDir;
        break;
      case "logfile":
        this.file = OuinetFile.ouinetDataDir;
        this.file.append("log.txt");
        break;
      case "last_used_udp_port":
        this.file = OuinetFile.ouinetDataDir;
        this.file.append("last_used_udp_port");
        break;
      case "frontend_unix_socket":
        this.file = OuinetFile.ouinetDataDir;
        this.file.append("frontend.socket");
        break;
      case "exit_cookie":
        this.file = OuinetFile.ouinetDataDir;
        this.file.append("exitCookie");
        break;
      case "bep5_http":
        this.file = OuinetFile.ouinetDataDir;
        this.file.append("bep5_http");
        break;
      case "metrics-server-cacert":
        this.file = OuinetFile.ouinetDir;
        this.file.append("metrics-server-cacert.pem");
        break;
      default:
        throw new Error("Unknown file type");
    }
  }

  // This function is used to set this.file from a string that contains a path.
  // As a matter of fact, it is used only when setting a path from preferences,
  // or to set the default IPC paths.
  setFileFromPath(path, isUserData) {
    if (OuinetLauncherUtil.isWindows) {
      path = path.replaceAll("/", "\\");
    }
    // Turn 'path' into an absolute path when needed.
    if (OuinetLauncherUtil.isPathRelative(path)) {
      if (OuinetLauncherUtil.isMac) {
        // On macOS, files are correctly separated because it was needed for the
        // gatekeeper signing.
        this.file = isUserData ? OuinetFile.dataDir : OuinetFile.appDir;
      } else {
        // Windows and Linux still use the legacy behavior.
        // To avoid breaking old installations, let's just keep it.
        this.file = OuinetFile.appDir;
        this.file.append("BaseBrowser");
      }
      this.file.appendRelativePath(path);
    } else {
      this.file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      this.file.initWithPath(path);
    }
  }

  createFile() {
    // Example of creating directories
    if (
      "repo" == this.fileType
    ) {
      this.file.create(this.file.DIRECTORY_TYPE, 0o700);
    } else {
      this.file.create(this.file.NORMAL_FILE_TYPE, 0o600);
    }
  }

  // Returns an nsIFile that points to the binary directory (on Linux and
  // Windows), and to the root of the application bundle on macOS.
  static get appDir() {
    if (!this._appDir) {
      // .../BaseBrowser on Windows and Linux, .../BaseBrowser.app/Contents/MacOS/ on
      // macOS.
      this._appDir = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent;
      if (OuinetLauncherUtil.isMac) {
        this._appDir = this._appDir.parent.parent;
      }
    }
    return this._appDir.clone();
  }

  // Returns an nsIFile that points to the data directory. This is usually
  // BaseBrowser/Data/ on Linux and Windows, and BaseBrowser-Data/ on macOS.
  // The parent directory of the default profile directory is taken.
  static get dataDir() {
    if (!this._dataDir) {
      // Notice that we use `DefProfRt`, because users could create their
      // profile in a completely unexpected directory: the profiles.ini contains
      // a IsRelative entry, which I expect could influence ProfD, but not this.
      const _dataDir = Services.dirsvc.get("DefProfRt", Ci.nsIFile).parent;
      if (OuinetLauncherUtil.isWindows) {
        // Data dir could be in a virtual AppData, translate the path to a real AppData path
        const _realDataDir = Services.OuinetNativeHelpers.GetRealAppData(_dataDir.path);
        const realDataDirFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        realDataDirFile.initWithPath(_realDataDir);
        lazy.log.debug("DataDir:", _dataDir.path, "RealDataDir:", realDataDirFile.path);
        this._dataDir = realDataDirFile;
      } else {
        this._dataDir = _dataDir;
      }
    }
    return this._dataDir.clone();
  }

  // Returns an nsIFile that points to the directory that contains the ouinet
  // client executable.
  static get ouinetDir() {
    if (!this._ouinetDir) {
      // The directory that contains firefox
      let ouinetDir = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent;
      if (!OuinetLauncherUtil.isMac) {
        ouinetDir.append("Ouinet");
      }
      // Save the value only if the XPCOM methods do not throw.
      this._ouinetDir = ouinetDir;
    }
    return this._ouinetDir.clone();
  }

  // Returns an nsIFile that points to the directory that contains the ouinet
  // data. Currently it is ${dataDir}/Ouinet.
  static get ouinetDataDir() {
    const dir = this.dataDir;
    dir.append("Ouinet");
    return dir;
  }
}

export const OuinetLauncherUtil = Object.freeze({
  get isAndroid() {
    return Services.appinfo.OS === "Android";
  },

  get isLinux() {
    // Use AppConstants for Linux rather then appinfo because we are sure it
    // will catch also various Unix flavors for which unofficial ports might
    // exist (which should work as Linux, as far as we know).
    return AppConstants.platform === "linux";
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
  // setProxyConfiguration() {
  //   Services.prefs.setCharPref("network.proxy.http", "127.0.0.1");
  //   Services.prefs.setIntPref("network.proxy.http_port", 8077);
  //   Services.prefs.setCharPref("network.proxy.ssl", "127.0.0.1");
  //   Services.prefs.setIntPref("network.proxy.ssl_port", 8077);
  //   Services.prefs.setIntPref("network.proxy.type", 1);
  //   // Force prefs to be synced to disk
  //   Services.prefs.savePrefFile(null);
  // },

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

        let certfilename = OuinetLauncherUtil.getOuinetFile("cacert", false).path
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

  // Returns an nsIFile.
  // If aOuinetFileType is "control_ipc" or "socks_ipc", aCreate is ignored
  // and there is no requirement that the IPC object exists.
  // For all other file types, null is returned if the file does not exist
  // and it cannot be created (it will be created if aCreate is true).
  getOuinetFile(aOuinetFileType, aCreate) {
    if (!aOuinetFileType) {
      return null;
    }
    try {
      const ouinetFile = new OuinetFile(aOuinetFileType, aCreate);
      return ouinetFile.getFile();
    } catch (e) {
      console.error(`getOuinetFile: cannot get ${aOuinetFileType}`, e);
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
