import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
});

const Prefs = Object.freeze({
  log_level: "browser.ouinet_process.log_level",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => {
  return console.createInstance({
    maxLogLevelPref: Prefs.log_level,
    prefix: "OuinetProcessTerminator",
  });
});

export class OuinetProcessTerminator {
  #subprocess = null;

  async terminate() {
    try {
      const exeFile = lazy.OuinetLauncherUtil.getOuinetFile("client-terminator", false);
      const args = [lazy.OuinetLauncherUtil.getOuinetFile("repo", false).path]
      const options = {
        command: exeFile.path,
        arguments: args,
        stderr: "stdout",
        workdir: lazy.OuinetLauncherUtil.getOuinetFile("startup-dir", false).path,
      };
      if (lazy.OuinetLauncherUtil.isLinux) {
        let ldLibPath = Services.env.get("LD_LIBRARY_PATH") ?? "";
        if (ldLibPath) {
          ldLibPath = ":" + ldLibPath;
        }
        options.environment = {
          LD_LIBRARY_PATH: exeFile.parent.path + ldLibPath,
        };
        options.environmentAppend = true;
      }
      const subprocess = await Subprocess.call(options);
      this.#processStdout();
      const { exitCode } = await subprocess.wait();
      this.#subprocess = null;
    } catch (e) {
      lazy.logger.error(e);
    }
  }

  async #processStdout() {
    let string;
    while (
      this.#subprocess &&
      (string = await this.#subprocess.stdout.readString())
    ) {
      lazy.logger.debug(string);
    }
  }
}
