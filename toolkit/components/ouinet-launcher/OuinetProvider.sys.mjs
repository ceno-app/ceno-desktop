/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

 import { ConsoleAPI } from "resource://gre/modules/Console.sys.mjs";
 
 import { OuinetLauncherUtil } from "resource://gre/modules/OuinetLauncherUtil.sys.mjs";
 import { OuinetProviderTopics } from "resource://gre/modules/OuinetProviderBuilder.sys.mjs";
 
 const lazy = {};
 ChromeUtils.defineESModuleGetters(lazy, {
   FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
   OuinetProcess: "resource://gre/modules/OuinetProcess.sys.mjs",
 });
 
 const logger = new ConsoleAPI({
   maxLogLevel: "warn",
   maxLogLevelPref: "browser.ouinet_provider.log_level",
   prefix: "OuinetProvider",
 });
 
 /**
  * This is a Ouinet provider for the C ouinet client daemon.
  *
  * It can start a new ouinent client instance, ( TODO: or connect to an existing one?).
  * In the former case, it also takes its ownership by default.
  */
 export class OuinetProvider {
   /**
    * The ouinet process we launched.
    *
    * @type {OuinetProcess}
    */
   #ouinetProcess = null;
 
   /**
    * Starts a new Ouinet process. (TODO: and connect to its control port, or connect to the
    * control port of an existing Ouinet daemon?)
    */
   async init() {
     logger.debug("Initializing the Ouinet provider.");
     if (this.ownsOuinetDaemon) {
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
 
     //OuinetLauncherUtil.setProxyConfiguration(this.#socksSettings);
 
     logger.info("The Ouinet provider is ready.");
 
     logger.debug(`Notifying ${OuinetProviderTopics.ProcessIsReady}`);
     Services.obs.notifyObservers(null, OuinetProviderTopics.ProcessIsReady);
   }
 
   /**
    * TODO: Look into how Ouinet client process can be killed
    * Close the connection to the tor daemon.
    * When Tor is started by Tor Browser, it is configured to exit when the
    * control connection is closed. Therefore, as a matter of facts, calling this
    * function also makes the child Tor instance stop.
    */
   uninit() {
     logger.debug("Uninitializing the Ouinet provider.");
 
     if (this.#ouinetProcess) {
       this.#ouinetProcess.forget();
       this.#ouinetProcess.onExit = () => {};
       this.#ouinetProcess = null;
     }
   }
 
   // Provider API
 
   /**
    * @returns {boolean} true if we launched and control ouinet client, (TODO: false if we are
    * using system ouinet client, this is not yet supported).
    */
   get ownsOuinetDaemon() {
     return OuinetLauncherUtil.shouldStartAndOwnOuinet;
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
     // OuinetProcess should be instanced once, then always reused and restarted
     // only through the prompt it exposes when the controlled process dies.
     if (this.#ouinetProcess) {
       logger.warn(
         "Ignoring a request to start a ouinet client daemon because one is already running."
       );
       return;
     }
 
     this.#ouinetProcess = new lazy.OuinetProcess();

     // Use a closure instead of bind because we reassign #cancelConnection.
     // Also, we now assign an exit handler that cancels the first connection,
     // so that a sudden exit before the first connection is completed might
     // still be handled as an initialization failure.
     // But after the first connection is created successfully, we will change
     // the exit handler to broadcast a notification instead.
     this.#ouinetProcess.onExit = () => {
        logger.debug("OuinetProcess.onExit");
        /*
       this.#cancelConnection(
         "The ouinet process exited before the first connection"
       );
       */
     };
 
     logger.debug("Trying to start the Ouinet client process.");
     const res = await this.#ouinetProcess.start();
     logger.info("Started a Ouinet client process");
   }
 }
 