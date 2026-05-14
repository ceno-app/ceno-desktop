const pendingFiles = [];

export function getPendingFiles() {
  const files = [...pendingFiles];
  pendingFiles.length = 0;
  return files;
}

export class eQsatCommandLineHandler {
  QueryInterface = ChromeUtils.generateQI(["nsICommandLineHandler"]);

  handle(cmdLine) {
    for (let i = cmdLine.length - 1; i >= 0; i--) {
      try {
        const arg = cmdLine.getArgument(i);
        const argLower = arg.toLowerCase();

        if (!argLower.endsWith(".ceno") && !argLower.endsWith(".zip")) {
          continue;
        }

        let uriStr;
        if (argLower.startsWith("file://")) {
          uriStr = arg;
        } else {
          const normalized = arg.replace(/\\/g, "/");
          uriStr = normalized.startsWith("/")
            ? "file://" + normalized   // Unix: /home/u/x.ceno
            : "file:///" + normalized; // Windows: C:/Users/u/x.ceno
        }

        const uri = Services.io.newURI(uriStr);
        const file = uri.QueryInterface(Ci.nsIFileURL).file;

        if (file.exists()) {
          pendingFiles.unshift(file);
          cmdLine.removeArguments(i, i);
        }
      } catch (e) {
        console.error(e);
        continue;
      }
    }
  }

  get helpInfo() {
    return "";
  }
}
