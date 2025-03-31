/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

 const lazy = {};
 ChromeUtils.defineESModuleGetters(lazy, {
   OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
   OuinetProvider: "resource://gre/modules/OuinetProvider.sys.mjs",
 });
 
 export const OuinetProviderTopics = Object.freeze({
   ProcessIsReady: "OuinetProcessIsReady",
   ProcessExited: "OuinetProcessExited",
   BootstrapStatus: "OuinetBootstrapStatus",
   BootstrapError: "OuinetBootstrapError",
   HasWarnOrErr: "OuinetLogHasWarnOrErr",
   BridgeChanged: "OuinetBridgeChanged",
 });
 
 export const OuinetProviders = Object.freeze({
   none: 0,
   ouinet: 1,
 });
 
 /**
  * The factory to get a Ouinet provider.
  * Currently we support only OuinetProvider, i.e., the one that interacts with
  * the C ouinet client.
  */
 export class OuinetProviderBuilder {
   /**
    * A promise with the instance of the provider that we are using.
    *
    * @type {Promise<OuinetProvider>?}
    */
   static #provider = null;
 
   /**
    * The observer that checks when the ouinet client process exits, and reinitializes the
    * provider.
    *
    * @type {Function}
    */
   static #exitObserver = null;
 
   /**
    * Tell whether the browser UI is ready.
    * We ignore any errors until it is because we cannot show them.
    *
    * @type {boolean}
    */
   static #uiReady = false;
 
   /**
    * Initialize the provider of choice./
    * Even though initialization is asynchronous, we do not expect the caller to
    * await this method. The reason is that any call to build() will wait the
    * initialization anyway (and re-throw any initialization error).
    */
   static async init() {
      await this.#initOuinetProvider();
   }
 
   static async #initOuinetProvider() {
     if (!this.#exitObserver) {
       this.#exitObserver = this.#ouinetExited.bind(this);
       Services.obs.addObserver(
         this.#exitObserver,
         OuinetProviderTopics.ProcessExited
       );
     }
 
     try {
       const old = await this.#provider;
       old?.uninit();
     } catch {}
     this.#provider = new Promise((resolve, reject) => {
       const provider = new lazy.OuinetProvider();
       provider
         .init()
         .then(() => resolve(provider))
         .catch(reject);
     });
     await this.#provider;
   }
 
   static uninit() {
     this.#provider?.then(provider => {
       provider.uninit();
       this.#provider = null;
     });
     if (this.#exitObserver) {
       Services.obs.removeObserver(
         this.#exitObserver,
         OuinetProviderTopics.ProcessExited
       );
       this.#exitObserver = null;
     }
   }
 
   /**
    * Build a provider.
    * This method will wait for the system to be initialized, and allows you to
    * catch also any initialization errors.
    */
   static async build() {
     if (!this.#provider && this.providerType === OuinetProviders.none) {
       throw new Error(
         "Ouinet Browser has been configured to use only the proxy functionalities."
       );
     } else if (!this.#provider) {
       throw new Error(
         "The provider has not been initialized or already uninitialized."
       );
     }
     return this.#provider;
   }
 
   static async #ouinetExited() {
     if (!this.#uiReady) {
       console.warn(
         `Seen ${OuinetProviderTopics.ProcessExited}, but not doing anything because the UI is not ready yet.`
       );
       return;
     }
     while (lazy.OuinetLauncherUtil.showRestartPrompt(false)) {
       try {
         await this.#initOuinetProvider();
         break;
       } catch {}
     }
   }
 
   /**
    * Return the provider chosen by the user.
    * This function checks the CENO_PROVIDER environment variable and if it is a
    * known provider, it returns its associated value.
    * Otherwise, if it is not valid, the C ouinet client implementation is chosen as the
    * default one.
    *
    * @returns {number} An entry from OuinetProviders
    */
   static get providerType() {
     // TODO: Add a preference to permanently save this without and avoid always
     // using an environment variable.
     let provider = OuinetProviders.ouinet;
     const kEnvName = "OUINET_PROVIDER";
     if (
       Services.env.exists(kEnvName) &&
       Services.env.get(kEnvName) in OuinetProviders
     ) {
       provider = OuinetProviders[Services.env.get(kEnvName)];
     }
     return provider;
   }
 }
 