/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

 import { ConsoleAPI } from "resource://gre/modules/Console.sys.mjs";
 
 import { CenoLauncherUtil } from "resource://gre/modules/CenoLauncherUtil.sys.mjs";
 import { CenoProviderTopics } from "resource://gre/modules/CenoProviderBuilder.sys.mjs";
 
 const lazy = {};
 ChromeUtils.defineESModuleGetters(lazy, {
   FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
   CenoProcess: "resource://gre/modules/CenoProcess.sys.mjs",
 });
 
 const logger = new ConsoleAPI({
   maxLogLevel: "warn",
   maxLogLevelPref: "browser.ceno_provider.log_level",
   prefix: "CenoProvider",
 });
 
 /**
  * This is a Ceno provider for the C ouinet client daemon.
  *
  * It can start a new ouinent client instance, ( TODO: or connect to an existing one?).
  * In the former case, it also takes its ownership by default.
  */
 export class CenoProvider {
   /**
    * The ceno process we launched.
    *
    * @type {CenoProcess}
    */
   #cenoProcess = null;
 
   /**
    * Starts a new Ceno process. (TODO: and connect to its control port, or connect to the
    * control port of an existing Ceno daemon?)
    */
   async init() {
     logger.debug("Initializing the Ceno provider.");
     if (this.ownsCenoDaemon) {
       try {
         await this.#startDaemon();
       } catch (e) {
         logger.error("Failed to start the ouinet client daemon", e);
         throw e;
       }
     } else {
       logger.debug(
         "Not starting a ouinet client daemon because we were requested not to."
       );
     }
 
     //CenoLauncherUtil.setProxyConfiguration(this.#socksSettings);
 
     logger.info("The Ceno provider is ready.");
 
     logger.debug(`Notifying ${CenoProviderTopics.ProcessIsReady}`);
     Services.obs.notifyObservers(null, CenoProviderTopics.ProcessIsReady);
   }
 
   /**
    * TODO: Look into how Ouinet client process can be killed
    * Close the connection to the tor daemon.
    * When Tor is started by Tor Browser, it is configured to exit when the
    * control connection is closed. Therefore, as a matter of facts, calling this
    * function also makes the child Tor instance stop.
    */
   uninit() {
     logger.debug("Uninitializing the Ceno provider.");
 
     if (this.#cenoProcess) {
       this.#cenoProcess.forget();
       this.#cenoProcess.onExit = () => {};
       this.#cenoProcess = null;
     }
   }
 
   // Provider API
 
   /**
    * @returns {boolean} true if we launched and control ouinet client, (TODO: false if we are
    * using system ouinet client, this is not yet supported).
    */
   get ownsCenoDaemon() {
     return CenoLauncherUtil.shouldStartAndOwnCeno;
   }
 
   /**
    * TODO: Actually check that ouinet client is running
    *
    * @returns {boolean} true if we currently have a connection to the control
    * port. We take for granted that if we have one, we authenticated to it, and
    * so we have already verified we can send and receive data.
    */
   get isRunning() {
     return true; //this.#controlConnection?.isOpen ?? false;
   }
 
   // Process management
 
   async #startDaemon() {
     // CenoProcess should be instanced once, then always reused and restarted
     // only through the prompt it exposes when the controlled process dies.
     if (this.#cenoProcess) {
       logger.warn(
         "Ignoring a request to start a ouinet client daemon because one is already running."
       );
       return;
     }
 
     this.#cenoProcess = new lazy.CenoProcess();

     // Use a closure instead of bind because we reassign #cancelConnection.
     // Also, we now assign an exit handler that cancels the first connection,
     // so that a sudden exit before the first connection is completed might
     // still be handled as an initialization failure.
     // But after the first connection is created successfully, we will change
     // the exit handler to broadcast a notification instead.
     this.#cenoProcess.onExit = () => {
        logger.debug("CenoProcess.onExit");
        /*
       this.#cancelConnection(
         "The ceno process exited before the first connection"
       );
       */
     };
 
     logger.debug("Trying to start the Ouinet client process.");
     const res = await this.#cenoProcess.start();
     logger.info("Started a Ouinet client process");
   }
 }
 