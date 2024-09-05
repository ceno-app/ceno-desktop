/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

 const lazy = {};
 ChromeUtils.defineESModuleGetters(lazy, {
   CenoLauncherUtil: "resource://gre/modules/CenoLauncherUtil.sys.mjs",
   CenoProvider: "resource://gre/modules/CenoProvider.sys.mjs",
 });
 
 export const CenoProviderTopics = Object.freeze({
   ProcessIsReady: "CenoProcessIsReady",
   ProcessExited: "CenoProcessExited",
   BootstrapStatus: "CenoBootstrapStatus",
   BootstrapError: "CenoBootstrapError",
   HasWarnOrErr: "CenoLogHasWarnOrErr",
   BridgeChanged: "CenoBridgeChanged",
 });
 
 export const CenoProviders = Object.freeze({
   none: 0,
   ceno: 1,
 });
 
 /**
  * The factory to get a Ceno provider.
  * Currently we support only CenoProvider, i.e., the one that interacts with
  * the C ouinet client.
  */
 export class CenoProviderBuilder {
   /**
    * A promise with the instance of the provider that we are using.
    *
    * @type {Promise<CenoProvider>?}
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
      await this.#initCenoProvider();
   }
 
   static async #initCenoProvider() {
     if (!this.#exitObserver) {
       this.#exitObserver = this.#cenoExited.bind(this);
       Services.obs.addObserver(
         this.#exitObserver,
         CenoProviderTopics.ProcessExited
       );
     }
 
     try {
       const old = await this.#provider;
       old?.uninit();
     } catch {}
     this.#provider = new Promise((resolve, reject) => {
       const provider = new lazy.CenoProvider();
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
         CenoProviderTopics.ProcessExited
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
     if (!this.#provider && this.providerType === CenoProviders.none) {
       throw new Error(
         "Ceno Browser has been configured to use only the proxy functionalities."
       );
     } else if (!this.#provider) {
       throw new Error(
         "The provider has not been initialized or already uninitialized."
       );
     }
     return this.#provider;
   }
 
   static async #cenoExited() {
     if (!this.#uiReady) {
       console.warn(
         `Seen ${CenoProviderTopics.ProcessExited}, but not doing anything because the UI is not ready yet.`
       );
       return;
     }
     while (lazy.CenoLauncherUtil.showRestartPrompt(false)) {
       try {
         await this.#initCenoProvider();
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
    * @returns {number} An entry from CenoProviders
    */
   static get providerType() {
     // TODO: Add a preference to permanently save this without and avoid always
     // using an environment variable.
     let provider = CenoProviders.ceno;
     const kEnvName = "CENO_PROVIDER";
     if (
       Services.env.exists(kEnvName) &&
       Services.env.get(kEnvName) in CenoProviders
     ) {
       provider = CenoProviders[Services.env.get(kEnvName)];
     }
     return provider;
   }
 }
 