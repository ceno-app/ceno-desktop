/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

 import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";
 import { ConsoleAPI } from "resource://gre/modules/Console.sys.mjs";
 import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
 
 const lazy = {};
 
 ChromeUtils.defineESModuleGetters(lazy, {
   OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
 });
 
 const OuinetProcessStatus = Object.freeze({
   Unknown: 0,
   Starting: 1,
   Running: 2,
   Exited: 3,
 });
 
 const logger = new ConsoleAPI({
   maxLogLevel: "info",
   prefix: "OuinetProcess",
 });
 
 export class OuinetProcess {
   #exeFile = null;
   #dataDir = null;
   #args = [];
   #subprocess = null;
   #status = OuinetProcessStatus.Unknown;

   #cacheHttpPublicKey = "zh6ylt6dghu6swhhje2j66icmjnonv53tstxxvj6acu64sc62fnq";
   #cacheType = "bep5-http";
   #injectorEndpoint = "utp+tls:46.4.14.190:7085";
   #injectorCredentials = "ouinet:160d79874a52c2cbcdec58db1a8160a9";
   #injectorTlsCertFile = null;
   #tlsCaCertStorePath = null;
 
   onExit = exitCode => {};
 
   constructor() {
   }
 
   get isRunning() {
     return (
       this.#status === OuinetProcessStatus.Starting ||
       this.#status === OuinetProcessStatus.Running
     );
   }
 
   async start() {
     if (this.#subprocess) {
       return;
     }
 
     this.#status = OuinetProcessStatus.Unknown;
 
     try {
       this.#makeArgs();
       /*
       // TODO: Can we use this PID to manage the ouinet client process?
       const pid = Services.appinfo.processID;
       if (pid !== 0) {
         this.#args.push("__OwningControllerProcess", pid.toString());
       }
       */
 
       this.#status = OuinetProcessStatus.Starting;
 
       // useful for simulating slow ouinet client launch
       const kPrefOuinetDaemonLaunchDelay = "extensions.ouinetlauncher.launch_delay";
       const launchDelay = Services.prefs.getIntPref(
         kPrefOuinetDaemonLaunchDelay,
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
         workdir: lazy.OuinetLauncherUtil.getOuinetFile("startup-dir", false).path,
       };
       this.#subprocess = await Subprocess.call(options);
       this.#status = OuinetProcessStatus.Running;

       // TODO: remove hard-coded delay before installing cert,
       // should detect if ouinet has created the cert file before proceeding
       await new Promise(resolve => setTimeout(() => resolve(), 5000));
       lazy.OuinetLauncherUtil.setRootCertificate()
       lazy.OuinetLauncherUtil.setExtensionPermissions()
     } catch (e) {
       this.#status = OuinetProcessStatus.Exited;
       this.#subprocess = null;
       logger.error("startOuinet error:", e);
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
     this.#status = OuinetProcessStatus.Exited;
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
         logger.debug(`A Ouinet process exited with code ${exitCode}.`);
       } else if (exitCode) {
         logger.warn(`The watched Ouinet process exited with code ${exitCode}.`);
       } else {
         logger.info("The Ouinet process exited.");
       }
     } catch (e) {
       logger.error("Failed to watch the Ouinet process", e);
     }
 
     if (watched === this.#subprocess) {
       this.#processExitedUnexpectedly(processExitCode);
     }
   }
 
   #processExitedUnexpectedly(exitCode) {
     this.#subprocess = null;
     this.#status = OuinetProcessStatus.Exited;
     logger.warn("Ouinet exited suddenly.");
     this.onExit(exitCode);
   }
 
   #makeArgs() {
     this.#exeFile = lazy.OuinetLauncherUtil.getOuinetFile("client", false);
     this.#dataDir = lazy.OuinetLauncherUtil.getOuinetFile("repo", true);
     this.#injectorTlsCertFile = lazy.OuinetLauncherUtil.getOuinetFile("injcert", false);
     this.#tlsCaCertStorePath = lazy.OuinetLauncherUtil.getOuinetFile("mozcert", false);
     // Create empty ouinet-client.conf file, required to start ouinet
     lazy.OuinetLauncherUtil.getOuinetFile("conf", true);
     /*
     // TODO: Implement localized strings to throw error
     let detailsKey;
     if (!this.#exeFile) {
       detailsKey = "client_missing";
     } else if (!this.#dataDir) {
       detailsKey = "datadir_missing";
     }
     if (detailsKey) {
       const details = lazy.OuinetLauncherUtil.getLocalizedString(detailsKey);
       const key = "unable_to_start_client";
       const err = 
       lazy.OuinetLauncherUtil.getFormattedLocalizedString(
         key,
         [details],
         1
       );
       throw new Error(err);
     }
     */
 
     this.#args = [];
     this.#args.push("--repo", this.#dataDir.path);
     this.#args.push("--cache-type", this.#cacheType);
     this.#args.push("--cache-http-public-key", this.#cacheHttpPublicKey);
     this.#args.push("--injector-ep", this.#injectorEndpoint);
     this.#args.push("--injector-credentials", this.#injectorCredentials);
     this.#args.push("--injector-tls-cert-file", this.#injectorTlsCertFile.path);
     this.#args.push("--tls-ca-cert-store-path", this.#tlsCaCertStorePath.path);
   }
 }
 