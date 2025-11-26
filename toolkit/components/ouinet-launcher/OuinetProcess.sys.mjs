/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
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

  onExit = _exitCode => {};

  async start(credentials) {
    if (this.#subprocess) {
      return;
    }

    this.#makeArgs(credentials);
    try {
      // useful for simulating slow ouinet client launch
      const launchDelay = Services.prefs.getIntPref(Prefs.launch_delay, 0);
      if (launchDelay > 0) {
        await new Promise(resolve => setTimeout(() => resolve(), launchDelay));
      }

      lazy.logger.debug(`Starting ${this.#exeFile.path}`, this.#args);
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
      this.#subprocess = await Subprocess.call(options);
    } catch (e) {
      this.#subprocess = null;
      lazy.logger.error(e);
      throw new OuinetStartupError(e);
    }

    // Do not await the following functions, as they will return only when the
    // process exits.
    this.#processStdout();
    this.#watchProcess();
  }

  // @TODO: Look into killing ouinet client process correctly
  // Proper way is SIGINT but it would require waiting for the process to exit.
  //
  // Firefox does not like to process socket I/O while
  // quitting if the browser did not finish starting up (e.g., when
  // someone presses the Quit button on our Network Settings window
  // during startup).
  //
  // Still, before closing the owning connection, this class should forget about
  // the process, so that future notifications will be ignored.
  stop() {
    this.#subprocess.kill()
    this.#subprocess.stdout.close();
    this.#subprocess = null;
  }

  async #processStdout() {
    let string;
    while (
      this.#subprocess &&
      (string = await this.#subprocess.stdout.readString())
    ) {
      dump(string);
    }
  }

  async #watchProcess() {
    let watched = this.#subprocess;
    if (!watched) {
      return;
    }
    let processExitCode;
    try {
      const { exitCode } = await watched.wait();
      processExitCode = exitCode;

      if (watched !== this.#subprocess) {
        lazy.logger.debug(`A Ouinet process exited with code ${exitCode}.`);
      } else if (exitCode) {
        lazy.logger.warn(`The watched Ouinet process exited with code ${exitCode}.`);
      } else {
        lazy.logger.info("The Ouinet process exited.");
      }
    } catch (e) {
      lazy.logger.error("Failed to watch the Ouinet process", e);
    }

    if (watched === this.#subprocess) {
      this.#processExitedUnexpectedly(processExitCode);
    }
  }

  #processExitedUnexpectedly(exitCode) {
    if (this.#subprocess !== null) {
      this.#subprocess = null;
      lazy.logger.warn("Ouinet exited suddenly.");
    }
    this.onExit(exitCode);
  }

  #makeArgs(credentials) {
    this.#exeFile = lazy.OuinetLauncherUtil.getOuinetFile("client", false);
    this.#dataDir = lazy.OuinetLauncherUtil.getOuinetFile("repo", true);
    this.#injectorTlsCertFile = lazy.OuinetLauncherUtil.getOuinetFile("injcert", false);
    this.#tlsCaCertStorePath = lazy.OuinetLauncherUtil.getOuinetFile("mozcert", false);
    // Create empty ouinet-client.conf file, required to start ouinet
    lazy.OuinetLauncherUtil.getOuinetFile("conf", true);

    if (!this.#exeFile) {
      throw new MissingOuinetBinaryError();
    } else if (!this.#dataDir) {
      throw new MissingDataDirError();
    }

    this.#args = [];
    this.#args.push("--repo", this.#dataDir.path);
    this.#args.push("--cache-type", this.#cacheType);
    this.#args.push("--cache-http-public-key", this.#cacheHttpPublicKey);
    this.#args.push("--injector-credentials", this.#injectorCredentials);
    this.#args.push("--injector-tls-cert-file", this.#injectorTlsCertFile.path);
    this.#args.push("--tls-ca-cert-store-path", this.#tlsCaCertStorePath.path);
    this.#args.push("--front-end-access-token", credentials.frontend_token)
    // this.#args.push("--proxy-access-token", credentials.proxy_token)
  }
}
