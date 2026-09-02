export class About_eQsat {
  QueryInterface = ChromeUtils.generateQI(["nsIAboutModule"]);

  getURIFlags(aURI) {
    return Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
           Ci.nsIAboutModule.ALLOW_SCRIPT |
           Ci.nsIAboutModule.IS_SECURE_CONTEXT;
  }

  newChannel(aURI, aLoadInfo) {
    const resourceURI = Services.io.newURI("resource:///modules/about-eqsat.xhtml");
    const chan = Services.io.newChannelFromURIWithLoadInfo(resourceURI, aLoadInfo);
    chan.originalURI = aURI;
    return chan;
  }
}
