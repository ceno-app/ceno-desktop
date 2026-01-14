// Save and load persistent config options when frontend is not available

const lazy = {};

const Prefs = Object.freeze({
  log_level: "ceno.network.log_level",
});

ChromeUtils.defineLazyGetter(lazy, "logger", () => {
  return console.createInstance({
    maxLogLevelPref: Prefs.log_level,
    prefix: "CenoNetwork",
  });
});
ChromeUtils.defineESModuleGetters(lazy, {
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  OuinetLauncherUtil: "resource://gre/modules/OuinetLauncherUtil.sys.mjs",
  OuinetPrefs: "resource://gre/modules/CenoNetwork.sys.mjs",
});

// BinaryOutputStream taken from XPInstall.sys.mjs
const BinaryOutputStream = Components.Constructor(
  "@mozilla.org/binaryoutputstream;1",
  "nsIBinaryOutputStream",
  "setOutputStream"
);

// FileOutputStream taken from XPInstall.sys.mjs
const FileOutputStream = Components.Constructor(
  "@mozilla.org/network/file-output-stream;1",
  "nsIFileOutputStream",
  "init"
);

// writeStringToFile taken from XPInstall.sys.mjs
/**
 * Write a given string to a file
 *
 * @param {nsIFile} file
 *        The nsIFile instance to write into
 * @param {string} string
 *        The string to write
 */
function writeStringToFile(file, string) {
  let fileStream = new FileOutputStream(
    file,
    lazy.FileUtils.MODE_WRONLY |
      lazy.FileUtils.MODE_CREATE |
      lazy.FileUtils.MODE_TRUNCATE,
    lazy.FileUtils.PERMS_FILE,
    0
  );

  try {
    let binStream = new BinaryOutputStream(fileStream);

    binStream.writeByteArray(new TextEncoder().encode(string));
  } finally {
    fileStream.close();
  }
}

function getEolType(content) {
  const eols = [
    content.indexOf("\r\n"),
    content.indexOf("\n"),
    content.indexOf("\r")
  ];
  for (let i = 0; i < 3; ++i) {
    if (eols[i] == -1) {
      eols[i] = Number.POSITIVE_INFINITY;
    }
  }
  if (eols[0] <= eols[1] && eols[0] <= eols[2])
    return "\r\n";
  if (eols[1] <= eols[0] && eols[1] <= eols[2])
    return "\r";
  else //if (eols[2] <= eols[0] && eols[2] <= eols[1])
    return "\n";
}

function updateSavedConfig(key, value) {
  return new Promise(async (resolve, reject) => {
    const savedConf = lazy.OuinetLauncherUtil.getOuinetFile("saved-conf", false);
    let reader = new FileReader();
    reader.onloadend = function () {
      let content = reader.result;
      const eolType = getEolType(content);

      const startPos = content.indexOf(key);
      if (startPos != -1) {
        const endPos = content.indexOf(eolType, startPos);
        if (endPos != -1) {
          content = content.slice(0, startPos) + key + " = " + value + content.slice(endPos);
        } else {
          content = content.slice(0, startPos) + key + " = " + value;
        }
      } else {
        content = key + " = " + value + eolType + content;
      }
      writeStringToFile(savedConf, content);
      resolve();
    };
    reader.readAsText(await File.createFromNsIFile(savedConf));
  });
}

export async function setValueInConfig(element_id, newValue) {
  if (element_id == "logfile") {
    await updateSavedConfig("enable-log-file", newValue ? 1 : 0)
  }
  else if (element_id == "metrics") {
    // Cannot save metrics toggle to ouinet config
    Services.prefs.setBoolPref(lazy.OuinetPrefs.metrics, newValue)
  }
  else if(element_id == "origin_access") {
    await updateSavedConfig("disable-origin-access", newValue ? 0 : 1)
  }
  else if(element_id == "proxy_access") {
    await updateSavedConfig("disable-proxy-access", newValue ? 0 : 1)
  }
  else if(element_id == "injector_access") {
    await updateSavedConfig("disable-injector-access", newValue ? 0 : 1)
  }
  else if(element_id == "distributed_cache") {
    await updateSavedConfig("disable-cache-access", newValue ? 0 : 1)
  }
  else {
    lazy.logger.error("setValueInConfig: unknown element:", element_id, newValue);
  }
}

export function getValuesFromConfig() {
  return new Promise(async (resolve, reject) => {
    const savedConf = lazy.OuinetLauncherUtil.getOuinetFile("saved-conf", false);
    let reader = new FileReader();
    reader.onloadend = function () {
      const eolType = getEolType(reader.result);
      const lines = reader.result.split(eolType);

      const values = {
        origin_access: undefined,
        proxy_access: undefined,
        injector_access: undefined,
        distributed_cache: undefined,

        logging: undefined,

        // Cannot save metrics toggle to ouinet config
        metrics: Services.prefs.getBoolPref(lazy.OuinetPrefs.metrics, undefined)
      };
      for (const line of lines) {
        const kv = line.split(" = ");
        if (kv.length == 2) {
          if (kv[0] == "enable-log-file") {
            values.logging = kv[1] == "1" ? true : false;
          }
          else if (kv[0] == "disable-origin-access") {
            values.origin_access = kv[1] == "1" ? false : true;
          }
          else if (kv[0] == "disable-proxy-access") {
            values.proxy_access = kv[1] == "1" ? false : true;
          }
          else if (kv[0] == "disable-injector-access") {
            values.injector_access = kv[1] == "1" ? false : true;
          }
          else if (kv[0] == "disable-cache-access") {
            values.distributed_cache = kv[1] == "1" ? false : true;
          }
        }
      }
      resolve(values);
    };
    reader.readAsText(await File.createFromNsIFile(savedConf));
  });
}
