import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { OuinetLauncherUtil } from "resource://gre/modules/OuinetLauncherUtil.sys.mjs";

const SUPPORTED_PACKAGE_VERSION = 1;

// Keep eQsatExtractorErrors in sync with about-eqsat.js
const eQsatExtractorErrors = Object.freeze({
  ZipFileMalformed: "eqsat-error-zip-file-malformed",
  MissingMetadata: "eqsat-error-missing-metadata",
  UpdateWithoutBase: "eqsat-error-update-without-base",
  InvalidFilename: "eqsat-error-invalid-filename",
  UnsupportedPackageVersion: "eqsat-error-unsupported-package-version",
});

// Keep eQsatExtractorStage in sync with about-eqsat.js
const eQsatExtractorStage = Object.freeze({
  Idle: 'Idle',
  ParsingZipFile: 'ParsingZipFile',
  Extracting: 'Extracting',
  ProcessingDHTGroups: 'ProcessingDHTGroups',
});

async function ensureParentDirExists(path, createdDirs) {
  const parentPath = PathUtils.parent(path);
  if (!(createdDirs.has(parentPath))) {
    await IOUtils.makeDirectory(parentPath, { createAncestors: true });
    createdDirs.add(parentPath);
  }
}

function readZipEntryText(zipReader, entryName) {
  let istream = null;
  try {
    const entry = zipReader.getEntry(entryName);
    istream = zipReader.getInputStream(entryName);
    return NetUtil.readInputStreamToString(istream, entry.realSize);
  } finally {
    try { istream.close(); } catch (e) {}
  }
}

class eQsatExtractorClass {
  #bep5HttpDir = Object.freeze(OuinetLauncherUtil.getOuinetFile("bep5_http", false).path);
  #eQsatExtractedPackagesDir = Object.freeze(PathUtils.join(this.#bep5HttpDir, "eQsat_extracted_packages"));

  #MAX_COMPLETED_RESULTS = 10;

  #idForExtraction = 1;
  #zipFileId = 1;

  #state = Object.seal({
    activeExtraction: Object.seal({
      stage: eQsatExtractorStage.Idle,
      filename: "",
      filepath: "",
      extract: Object.seal({
        total: 0,
        processed: 0,
      }),
    }),

    completedResultsIds: [],
    zipFileIdQueue: [],
  });
  #completedResultsStore = new Map();
  #zipFileQueueStore = new Map();
  #requestToCancelCurrentExtraction = false;
  #requestToCancelAllExtractions = false;

  async #resetActiveExtractionState(stage, zipFileName, zipFilePath) {
    this.#state.activeExtraction.stage = stage;
    this.#state.activeExtraction.filename = zipFileName;
    this.#state.activeExtraction.filepath = zipFilePath;
    this.#state.activeExtraction.extract.total = 0;
    this.#state.activeExtraction.extract.processed = 0;
    await this.#notifyProgress();
  }

  get isExtracting() {
    return this.#state.activeExtraction.stage !== eQsatExtractorStage.Idle;
  }

  getState() {
    return {
      activeExtraction: this.#state.activeExtraction,
      completedResultsIds: [...this.#state.completedResultsIds],
      zipFileIdQueue: [...this.#state.zipFileIdQueue],
    };
  }
  getResultsByIds(ids) {
    return ids.map(id => this.#completedResultsStore.get(id)).filter(Boolean);
  }
  getQueueItemsByIds(ids) {
    return ids.map(id => this.#zipFileQueueStore.get(id)).filter(Boolean);
  }

  removeFromQueue(zipFileId) {
    zipFileId = Number(zipFileId);
    const idx = this.#state.zipFileIdQueue.indexOf(zipFileId);
    if (idx === -1) {
      return false;
    }
    this.#zipFileQueueStore.delete(zipFileId);
    const next = [...this.#state.zipFileIdQueue];
    next.splice(idx, 1);
    this.#state.zipFileIdQueue = next;
    return true;
  }
  cancelCurrentExtraction() {
    this.#requestToCancelCurrentExtraction = true;
  }
  cancelAll() {
    this.#requestToCancelCurrentExtraction = true;
    this.#requestToCancelAllExtractions = true;
  }

  #lastNotifyTime = 0;
  #lastNotifyStage = null;
  #lastYieldTime = Date.now();
  async #notifyProgress() {
    const notifyThrottleMs = 100;

    const now = Date.now();
    if (this.#lastNotifyStage !== this.#state.activeExtraction.stage || (now - this.#lastNotifyTime) >= notifyThrottleMs) {
      Services.obs.notifyObservers(null, "eqsat:update", JSON.stringify(this.#state));
      this.#lastNotifyStage = this.#state.activeExtraction.stage;
      this.#lastNotifyTime = now;
    }

    const isDone = this.#state.activeExtraction.stage === eQsatExtractorStage.Idle;
    const yieldEveryMs = 20;
    if (!isDone && (now - this.#lastYieldTime) >= yieldEveryMs) {
      await new Promise(r => Services.tm.mainThread.dispatch(r, Ci.nsIThread.DISPATCH_NORMAL));
      this.#lastYieldTime = now;
    }
  }

  async #processDhtGroups(zipReader, result) {
    this.#state.activeExtraction.stage = eQsatExtractorStage.ProcessingDHTGroups;
    await this.#notifyProgress();

    result.dhtGroups = [];
    try {
      const groupsText = readZipEntryText(zipReader, "groups");
      for (const rawLine of groupsText.split(/\r?\n|\r/)) {
        const line = rawLine.trim();
        if (line) {
          result.dhtGroups.push(line);
        }
      }
    } catch (e) {
      console.error(e);
    }

    Object.freeze(result.dhtGroups);
  }

  async processZipFiles(zipFiles) {
    const existingPaths = new Set();
    this.#zipFileQueueStore.forEach(item => existingPaths.add(item.filePath));
    if (this.#state.activeExtraction.stage != eQsatExtractorStage.Idle) {
      existingPaths.add(this.#state.activeExtraction.filepath);
    }

    const newIds = [];
    for (const zipFile of zipFiles) {
      if (existingPaths.has(zipFile.path)) {
        continue;
      }
      const item = {
        id: this.#zipFileId++,
        fileName: zipFile.leafName,
        filePath: zipFile.path,
      };
      this.#zipFileQueueStore.set(item.id, item);
      newIds.push(item.id);
      existingPaths.add(zipFile.path);
    }
    if (newIds.length > 0) {
      this.#state.zipFileIdQueue = [...this.#state.zipFileIdQueue, ...newIds];
      await this.#processZipFileQueue();
    }
  }

  async #parseZipFile(zipReader, result) {
    let metadata;
    try {
      const jsonText = readZipEntryText(zipReader, "metadata");
      metadata = JSON.parse(jsonText);
    } catch (e) {
      console.error(e);
      throw new Error(eQsatExtractorErrors.MissingMetadata);
    }
    if (typeof metadata.id !== "string" || typeof metadata.type !== "string"
      || (metadata.type !== "update" && metadata.type !== "base")
    ) {
      throw new Error(eQsatExtractorErrors.MissingMetadata);
    }

    if (typeof metadata.version === "string") {
      metadata.version = Number(metadata.version);
    }
    if (typeof metadata.version !== "number") {
      metadata.version = 1;
    }
    if (metadata.version !== SUPPORTED_PACKAGE_VERSION) {
      throw new Error(eQsatExtractorErrors.UnsupportedPackageVersion);
    }

    metadata.packageIdFile = PathUtils.join(this.#eQsatExtractedPackagesDir, metadata.id);
    if (metadata.type === "update") {
      if (!(await IOUtils.exists(metadata.packageIdFile))) {
        throw new Error(eQsatExtractorErrors.UpdateWithoutBase);
      }
    }

    const fileEntries = [];
    const entries = zipReader.findEntries('bep5_http/*');
    while (entries.hasMore()) {
      const entryName = entries.getNext();
      const entry = zipReader.getEntry(entryName);
      if (!entry.isDirectory) {
        const entryRelativePath = entryName.slice("bep5_http/".length).split('/').filter(p => p.length > 0);
        if (entryRelativePath.includes("..") || entryRelativePath.length === 0) {
          result.errors.push({file: entryName, error: eQsatExtractorErrors.InvalidFilename});
          continue;
        }
        const target = PathUtils.join(this.#bep5HttpDir, ...entryRelativePath);
        fileEntries.push([entryName, target]);
        this.#state.activeExtraction.extract.total = fileEntries.length;

        await this.#notifyProgress();
        if (this.#requestToCancelCurrentExtraction) {
          break;
        }
      }
    }
    return [
      Object.freeze(metadata),
      Object.freeze(fileEntries),
    ];
  }

  async #extractFilesFromZip(zipReader, fileEntries, result, createdDirs) {
    this.#state.activeExtraction.stage = eQsatExtractorStage.Extracting;
    await this.#notifyProgress();

    for (const [entryName, targetPath] of fileEntries) {
      await ensureParentDirExists(targetPath, createdDirs);
      const istream = zipReader.getInputStream(entryName);
      const fostream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      const targetFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      targetFile.initWithPath(targetPath);
      fostream.init(targetFile, -1, -1, 0);
      try {
        await new Promise((resolve, reject) => {
          NetUtil.asyncCopy(istream, fostream, (rv) => {
            if (Components.isSuccessCode(rv)) {
              resolve();
            } else {
              reject(new Error(`Failed to extract ${entryName}: 0x${rv.toString(16)}`));
            }
          });
        });
      } catch (e) {
        result.errors.push({file: entryName, error: e.message});
      } finally {
        try { fostream.close(); } catch (e) {}
        try { istream.close(); } catch (e) {}
      }
      this.#state.activeExtraction.extract.processed++;
      await this.#notifyProgress();
      if (this.#requestToCancelCurrentExtraction) {
        break;
      }
    }
  }

  async #processZipFileQueue() {
    if (this.#state.activeExtraction.stage !== eQsatExtractorStage.Idle) {
      return;
    }

    const createdDirs = new Set();
    const attemptedBaselessUpdates = new Set();
    while (this.#state.zipFileIdQueue.length > 0) {
      this.#requestToCancelCurrentExtraction = false;
      if (this.#requestToCancelAllExtractions) {
        this.#state.zipFileIdQueue = [];
        this.#zipFileQueueStore.clear();
        this.#requestToCancelAllExtractions = false;
        break;
      }
      const zipFileId = this.#state.zipFileIdQueue.shift();
      const zipFile = this.#zipFileQueueStore.get(zipFileId);
      this.#zipFileQueueStore.delete(zipFileId);

      await this.#resetActiveExtractionState(eQsatExtractorStage.ParsingZipFile, zipFile.fileName, zipFile.filePath);

      const result = Object.seal({
        id: Object.freeze(this.#idForExtraction++),
        zipFileName: Object.freeze(zipFile.fileName),
        zipFilePath: Object.freeze(zipFile.filePath),
        dhtGroups: [],
        errors: [],
      });

      const zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
      const nsIZipFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      try {
        nsIZipFile.initWithPath(zipFile.filePath);
        zipReader.open(nsIZipFile);
        const [metadata, fileEntries] = await this.#parseZipFile(zipReader, result);
        if (this.#requestToCancelCurrentExtraction) {
          continue;
        }

        await this.#extractFilesFromZip(zipReader, fileEntries, result, createdDirs);
        if (this.#requestToCancelCurrentExtraction) {
          continue;
        }

        if (metadata.type === "base") {
          await ensureParentDirExists(metadata.packageIdFile, createdDirs);
          await IOUtils.writeUTF8(metadata.packageIdFile, "1");
        }
        await this.#processDhtGroups(zipReader, result);
        if (this.#requestToCancelCurrentExtraction) {
          continue;
        }
      } catch (e) {
        if (e.result === Cr.NS_ERROR_FILE_CORRUPTED || e.result === 0x80520001) {
          result.errors.push({ file: zipFile.fileName, error: eQsatExtractorErrors.ZipFileMalformed});
        } else if (e.message === eQsatExtractorErrors.UpdateWithoutBase
            && this.#state.zipFileIdQueue.length > 0
            && !attemptedBaselessUpdates.has(zipFile.id)
        ) {
          const readdedZipFile = {
            id: this.#zipFileId++,
            fileName: zipFile.fileName,
            filePath: zipFile.filePath,
          }
          attemptedBaselessUpdates.add(readdedZipFile.id);
          this.#state.zipFileIdQueue.push(readdedZipFile.id);
          this.#zipFileQueueStore.set(readdedZipFile.id, readdedZipFile);
        } else {
          result.errors.push({ file: zipFile.fileName, error: e.message });
        }
        console.error("Extraction error:", e);
      } finally {
        try { zipReader.close(); } catch (e) {}
      }

      Object.freeze(result.errors);
      this.#completedResultsStore.set(result.id, Object.freeze(result));

      this.#state.completedResultsIds.unshift(result.id);
      while (this.#state.completedResultsIds.length > this.#MAX_COMPLETED_RESULTS) {
        const droppedId = this.#state.completedResultsIds.pop();
        this.#completedResultsStore.delete(droppedId);
      }
    }
    await this.#resetActiveExtractionState(eQsatExtractorStage.Idle, "");
  }
}

const eQsatExtractor = new eQsatExtractorClass();
export { eQsatExtractor, eQsatExtractorErrors, eQsatExtractorStage };
