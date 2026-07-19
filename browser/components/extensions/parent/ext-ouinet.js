"use strict";

ChromeUtils.defineESModuleGetters(this, {
  CenoNetwork: "resource://gre/modules/CenoNetwork.sys.mjs",
});

this.ouinet = class extends ExtensionAPI {
  getAPI(context) {
    return {
      ouinet: {
        onConnect: new EventManager({
          context,
          module: "ouinet",
          event: "onConnect",
          register: fire => {
            const callback = async (proxy_endpoint, proxy_user, proxy_pass) => {
              fire.async(proxy_endpoint, proxy_user, proxy_pass);
            };
            CenoNetwork.RegisterExtensionOnConnectCallback(callback);
            return () => {
              CenoNetwork.UnregisterExtensionOnConnectCallback();
            };
          }
        }).api(),
        onDisconnect: new EventManager({
          context,
          module: "ouinet",
          event: "onDisconnect",
          register: fire => {
            const callback = async () => {
              fire.async();
            };
            CenoNetwork.RegisterExtensionOnDisconnectCallback(callback);
            return () => {
              CenoNetwork.UnregisterExtensionOnDisconnectCallback();
            };
          }
        }).api(),
      }
    }
  }
}
