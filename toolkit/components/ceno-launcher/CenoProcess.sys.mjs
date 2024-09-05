/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

 import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";
 import { ConsoleAPI } from "resource://gre/modules/Console.sys.mjs";
 import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
 
 const lazy = {};
 
 ChromeUtils.defineESModuleGetters(lazy, {
   CenoLauncherUtil: "resource://gre/modules/CenoLauncherUtil.sys.mjs",
 });
 
 const CenoProcessStatus = Object.freeze({
   Unknown: 0,
   Starting: 1,
   Running: 2,
   Exited: 3,
 });
 
 const logger = new ConsoleAPI({
   maxLogLevel: "info",
   prefix: "CenoProcess",
 });
 
 export class CenoProcess {
   #exeFile = null;
   #dataDir = null;
   #args = [];
   #subprocess = null;
   #status = CenoProcessStatus.Unknown;
 
   onExit = exitCode => {};
 
   constructor() {
   }
 
   get isRunning() {
     return (
       this.#status === CenoProcessStatus.Starting ||
       this.#status === CenoProcessStatus.Running
     );
   }
 
   async start() {
     if (this.#subprocess) {
       return;
     }
 
     this.#status = CenoProcessStatus.Unknown;
 
     try {
       this.#makeArgs();
       /*
       // TODO: Can we use this PID to manage the ouinet client process?
       const pid = Services.appinfo.processID;
       if (pid !== 0) {
         this.#args.push("__OwningControllerProcess", pid.toString());
       }
       */
 
       this.#status = CenoProcessStatus.Starting;
 
       // useful for simulating slow ouinet client launch
       const kPrefCenoDaemonLaunchDelay = "extensions.cenolauncher.launch_delay";
       const launchDelay = Services.prefs.getIntPref(
         kPrefCenoDaemonLaunchDelay,
         0
       );
       if (launchDelay > 0) {
         await new Promise(resolve => setTimeout(() => resolve(), launchDelay));
       }
 
       logger.debug(`Starting ${this.#exeFile.path}`, this.#args);
       const options = {
         command: this.#exeFile.path,
         arguments: this.#args,
         stderr: "stdout",
         workdir: lazy.CenoLauncherUtil.getCenoFile("startup-dir", false).path,
       };
       this.#subprocess = await Subprocess.call(options);
       this.#status = CenoProcessStatus.Running;

       // TODO: remove hard-coded delay before installing cert,
       // should detect if ouinet has created the cert file before proceeding
       await new Promise(resolve => setTimeout(() => resolve(), 5000));
       lazy.CenoLauncherUtil.setRootCertificate()
       lazy.CenoLauncherUtil.setExtensionPermissions()
     } catch (e) {
       this.#status = CenoProcessStatus.Exited;
       this.#subprocess = null;
       logger.error("startCeno error:", e);
       throw e;
     }
 
     // Do not await the following functions, as they will return only when the
     // process exits.
     this.#dumpStdout();
     this.#watchProcess();
   }
 
   // TODO: Look into killing ouinet client process correctly
   // Forget about a process.
   //
   // Instead of killing the tor process, we rely on the TAKEOWNERSHIP feature
   // to shut down tor when we close the control port connection.
   //
   // Previously, we sent a SIGNAL HALT command to the tor control port,
   // but that caused hangs upon exit in the Firefox 24.x based browser.
   // Apparently, Firefox does not like to process socket I/O while
   // quitting if the browser did not finish starting up (e.g., when
   // someone presses the Quit button on our Network Settings window
   // during startup).
   //
   // Still, before closing the owning connection, this class should forget about
   // the process, so that future notifications will be ignored.
   forget() {
     this.#subprocess.kill()
     this.#subprocess.stdout.close();
     this.#subprocess = null;
     this.#status = CenoProcessStatus.Exited;
   }
 
   async #dumpStdout() {
     let string;
     while (
       this.#subprocess &&
       (string = await this.#subprocess.stdout.readString())
     ) {
       dump(string);
     }
   }
 
   async #watchProcess() {
     const watched = this.#subprocess;
     if (!watched) {
       return;
     }
     let processExitCode;
     try {
       const { exitCode } = await watched.wait();
       processExitCode = exitCode;
 
       if (watched !== this.#subprocess) {
         logger.debug(`A Ceno process exited with code ${exitCode}.`);
       } else if (exitCode) {
         logger.warn(`The watched Ceno process exited with code ${exitCode}.`);
       } else {
         logger.info("The Ceno process exited.");
       }
     } catch (e) {
       logger.error("Failed to watch the Ceno process", e);
     }
 
     if (watched === this.#subprocess) {
       this.#processExitedUnexpectedly(processExitCode);
     }
   }
 
   #processExitedUnexpectedly(exitCode) {
     this.#subprocess = null;
     this.#status = CenoProcessStatus.Exited;
     logger.warn("Ceno exited suddenly.");
     this.onExit(exitCode);
   }
 
   #makeArgs() {
     this.#exeFile = lazy.CenoLauncherUtil.getCenoFile("client", false);
     this.#dataDir = lazy.CenoLauncherUtil.getCenoFile("repos-client", false);
     /*
     // TODO: Implement localized strings to throw error
     let detailsKey;
     if (!this.#exeFile) {
       detailsKey = "client_missing";
     } else if (!this.#dataDir) {
       detailsKey = "datadir_missing";
     }
     if (detailsKey) {
       const details = lazy.CenoLauncherUtil.getLocalizedString(detailsKey);
       const key = "unable_to_start_client";
       const err = 
       lazy.CenoLauncherUtil.getFormattedLocalizedString(
         key,
         [details],
         1
       );
       throw new Error(err);
     }
     */
 
     this.#args = [];
     this.#args.push("--repo", this.#dataDir.path)
     // TODO push tls-cert arg with dynamic path here
   }
 }
 