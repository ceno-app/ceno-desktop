/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

const Prefs = Object.freeze({
  log_level: "browser.ouinet_process.log_level",
  launch_delay: "browser.ouinet_process.launch_delay",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => {
  return console.createInstance({
    maxLogLevelPref: Prefs.log_level,
    prefix: "OuinetProcess",
  });
});

/**
 * This class can be used to start a ouinet daemon instance and receive
 * notifications when it exits.
 * It will automatically convert the settings objects into the appropriate
 * command line arguments.
 */
export class OuinetProcess {
  static #exeFile = lazy.OuinetLauncherUtil.getOuinetFile("client", false);
  static #dataDir = lazy.OuinetLauncherUtil.getOuinetFile("repo", true);

  static #cacheHttpPublicKey = "zh6ylt6dghu6swhhje2j66icmjnonv53tstxxvj6acu64sc62fnq";
  static #cacheType = "bep5-http";
  static #injectorCredentials = "ouinet:160d79874a52c2cbcdec58db1a8160a9";
  static #injectorTlsCertFile = lazy.OuinetLauncherUtil.getOuinetFile("injcert", false);
  static #tlsCaCertStorePath = lazy.OuinetLauncherUtil.getOuinetFile("mozcert", false);

  static #metricsServerUrl = "https://endpoint-dev.ouinet.work/.well-known/endpoint";
  static #metricsServerCaCertFile = lazy.OuinetLauncherUtil.getOuinetFile("metrics-server-cacert", false);
  static #metricsEncryptionKey = "MCowBQYDK2VuAyEAmfqHeh9oZ4S42+NS9s9unqcfqxzKIcKQfxBmk2osQA0=";
  static #metricsServerToken = "CcmPTtdB5unF8q74AlGf1XMHYuo9opst";

  static #pidPref = "ceno.network.pid";
  static pidExists() {
    return null != Services.prefs.getIntPref(OuinetProcess.#pidPref, null);
  }

  #args = [];
  #subprocess = null;
  #onExit = _exitCode => {};

  #onExitWrapper = _exitCode => {
    this.#subprocess = null;
    Services.prefs.setIntPref(OuinetProcess.#pidPref, null);
    if (this.#onExit) {
      this.#onExit(_exitCode);
    }
  }
  constructor(onExit) {
    this.#onExit = onExit;
  }

  async start(credentials, config) {
    // Create empty ouinet-client.conf file, required to start ouinet
    lazy.OuinetLauncherUtil.getOuinetFile("conf", true);

    this.#makeArgs(credentials, config);

    lazy.logger.debug(`Starting ${OuinetProcess.#exeFile.path}`, this.#args.join(' '));
    const options = {
      command: OuinetProcess.#exeFile.path,
      arguments: this.#args,
      stdin: 'devnull',
      stdout: 'devnull',
      stderr: 'devnull',
      workdir: lazy.OuinetLauncherUtil.getOuinetFile("startup-dir", false).path,
    };
    if (lazy.OuinetLauncherUtil.isLinux) {
      let ldLibPath = Services.env.get("LD_LIBRARY_PATH") ?? "";
      if (ldLibPath) {
        ldLibPath = ":" + ldLibPath;
      }
      options.environment = {
        LD_LIBRARY_PATH: OuinetProcess.#exeFile.parent.path + ldLibPath,
      };
      options.environmentAppend = true;
    }
    this.#subprocess = await lazy.Subprocess.call(options);
    Services.prefs.setIntPref(OuinetProcess.#pidPref, this.#subprocess.pid);
    this.#watchProcess();
  }

  async #watchProcess() {
    const watched = this.#subprocess;
    if (!watched) {
      return;
    }
    const { exitCode } = await watched.wait();
    if (watched === this.#subprocess) {
      this.#onExitWrapper(exitCode);
    }
  }

  inherit() {
    const pid = Services.prefs.getIntPref(OuinetProcess.#pidPref, null);
    if (!pid) {
      return;
    }

    if (lazy.OuinetLauncherUtil.isWindows) {
      const onExitLocalCopy = (exitCode) => {
        this.#onExitWrapper(exitCode);
      }
      const processObserver = {
        QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
        observe: function(subject, topic, exitCode) {
          onExitLocalCopy(exitCode);
        }
      };
      try {
        Services.OuinetNativeHelpers.MonitorProcess(pid, processObserver);
      } catch (e) {
        lazy.logger.error('Failed to monitor process.', e);
        this.#onExitWrapper(1);
      }
    } else {
      throw new Error("OuinetProcess.inherit() is not implemented for this platform");
    }
  }

  stop() {
    const pid = Services.prefs.getIntPref(OuinetProcess.#pidPref, null);
    if (pid) {
      if (lazy.OuinetLauncherUtil.isWindows) {
        try {
          Services.OuinetNativeHelpers.EndProcess(pid);
        } catch (e) {
          lazy.logger.error('Failed to end process.', e);
          Services.prefs.setIntPref(OuinetProcess.#pidPref, null);
        }
      } else {
        throw new Error("OuinetProcess.stop() is not implemented for this platform");
      }
    }
  }

  #makeArgs(credentials, config) {
    this.#args = [];
    this.#args.push("--repo", OuinetProcess.#dataDir.path);
    this.#args.push("--cache-type", OuinetProcess.#cacheType);
    this.#args.push("--cache-http-public-key", OuinetProcess.#cacheHttpPublicKey);
    this.#args.push("--injector-credentials", OuinetProcess.#injectorCredentials);
    this.#args.push("--injector-tls-cert-file", OuinetProcess.#injectorTlsCertFile.path);
    this.#args.push("--tls-ca-cert-store-path", OuinetProcess.#tlsCaCertStorePath.path);
    this.#args.push("--listen-on-tcp", '127.0.0.1:0');
    this.#args.push("--client-credentials", `${credentials.proxy_user}:${credentials.proxy_password}`)
    this.#args.push("--front-end-unix-socket-ep", lazy.OuinetLauncherUtil.getOuinetFile("frontend_unix_socket", false).path);
    this.#args.push("--front-end-ep", '127.0.0.1:0');
    this.#args.push("--front-end-access-token", credentials.frontend_token)

    this.#args.push("--drop-saved-opts");

    if (config.metrics) {
      this.#args.push("--metrics-enable-on-start");
    }
    this.#args.push("--metrics-server-url", OuinetProcess.#metricsServerUrl);
    this.#args.push("--metrics-server-cacert-file", OuinetProcess.#metricsServerCaCertFile.path);
    this.#args.push("--metrics-encryption-key", OuinetProcess.#metricsEncryptionKey);
    this.#args.push("--metrics-server-token", OuinetProcess.#metricsServerToken);

    if (config.logging) {
      this.#args.push("--enable-log-file");
    }
    this.#args.push("--log-level", config.logging_level);
    if (config.doh) {
      this.#args.push("--dns-protocol", "https");
    }
    if (config.unencrypted_dns) {
      this.#args.push("--dns-protocol", "plain");
    }
    if (!config.bridge) {
      this.#args.push("--disable-bridge-announcement");
    }
    if (!config.origin_access) {
      this.#args.push("--disable-origin-access");
    }
    if (!config.proxy_access) {
      this.#args.push("--disable-proxy-access");
    }
    if (!config.injector_access) {
      this.#args.push("--disable-injector-access");
    }
    if (!config.distributed_cache) {
      this.#args.push("--disable-cache-access");
    }
  }
}
