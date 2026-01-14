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

export class MissingOuinetBinaryError extends Error {};
export class MissingDataDirError extends Error {};
export class OuinetStartupError extends Error {};

/**
 * This class can be used to start a ouinet daemon instance and receive
 * notifications when it exits.
 * It will automatically convert the settings objects into the appropriate
 * command line arguments.
 */
export class OuinetProcess {
  #exeFile = null;
  #dataDir = null;
  #args = [];
  #subprocess = null;

  #cacheHttpPublicKey = "zh6ylt6dghu6swhhje2j66icmjnonv53tstxxvj6acu64sc62fnq";
  #cacheType = "bep5-http";
  #injectorCredentials = "ouinet:160d79874a52c2cbcdec58db1a8160a9";
  #injectorTlsCertFile = null;
  #tlsCaCertStorePath = null;

  #metricsServerUrl = "https://endpoint-dev.ouinet.work/.well-known/endpoint";
  #metricsServerCaCertFile = null;
  #metricsEncryptionKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VuAyEAmfqHeh9oZ4S42+NS9s9unqcfqxzKIcKQfxBmk2osQA0=
-----END PUBLIC KEY-----`;
  #metricsServerToken = "CcmPTtdB5unF8q74AlGf1XMHYuo9opst";

  async start(credentials, config) {
    this.#makeArgs(credentials, config);

    lazy.logger.debug(`Starting ${this.#exeFile.path}`, this.#args.join(' '));
    const options = {
      command: this.#exeFile.path,
      arguments: this.#args,
      stderr: "stdout",
      workdir: lazy.OuinetLauncherUtil.getOuinetFile("startup-dir", false).path,
    };
    if (lazy.OuinetLauncherUtil.isLinux) {
      let ldLibPath = Services.env.get("LD_LIBRARY_PATH") ?? "";
      if (ldLibPath) {
        ldLibPath = ":" + ldLibPath;
      }
      options.environment = {
        LD_LIBRARY_PATH: this.#exeFile.parent.path + ldLibPath,
      };
      options.environmentAppend = true;
    }
    this.#subprocess = await lazy.Subprocess.call(options);
  }

  stop() {
    this.#subprocess.kill()
    // this.#subprocess.stdout.close();
    this.#subprocess = null;
  }

  #makeArgs(credentials, config) {
    this.#exeFile = lazy.OuinetLauncherUtil.getOuinetFile("client", false);
    this.#dataDir = lazy.OuinetLauncherUtil.getOuinetFile("repo", true);
    this.#injectorTlsCertFile = lazy.OuinetLauncherUtil.getOuinetFile("injcert", false);
    this.#tlsCaCertStorePath = lazy.OuinetLauncherUtil.getOuinetFile("mozcert", false);
    this.#metricsServerCaCertFile = lazy.OuinetLauncherUtil.getOuinetFile("metrics-server-cacert", false);

    // Create empty ouinet-client.conf file, required to start ouinet
    lazy.OuinetLauncherUtil.getOuinetFile("conf", true);

    this.#args = [];
    this.#args.push("--repo", this.#dataDir.path);
    this.#args.push("--cache-type", this.#cacheType);
    this.#args.push("--cache-http-public-key", this.#cacheHttpPublicKey);
    this.#args.push("--injector-credentials", this.#injectorCredentials);
    this.#args.push("--injector-tls-cert-file", this.#injectorTlsCertFile.path);
    this.#args.push("--tls-ca-cert-store-path", this.#tlsCaCertStorePath.path);
    this.#args.push("--listen-on-tcp", '127.0.0.1:0');
    this.#args.push("--client-credentials", `${credentials.proxy_user}:${credentials.proxy_password}`)
    this.#args.push("--front-end-unix-socket-ep", lazy.OuinetLauncherUtil.getOuinetFile("frontend_unix_socket", false).path);
    this.#args.push("--front-end-ep", '127.0.0.1:0');
    this.#args.push("--front-end-access-token", credentials.frontend_token)

    this.#args.push("--drop-saved-opts");

    if (config.metrics) {
      this.#args.push("--metrics-enable-on-start");
    }
    this.#args.push("--metrics-server-url", this.#metricsServerUrl);
    this.#args.push("--metrics-server-cacert-file", this.#metricsServerCaCertFile.path);
    this.#args.push("--metrics-encryption-key", this.#metricsEncryptionKey);
    this.#args.push("--metrics-server-token", this.#metricsServerToken);

    if (config.logging) {
      this.#args.push("--enable-log-file");
    }
    if (!config.doh) {
      this.#args.push("--disable-doh");
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
