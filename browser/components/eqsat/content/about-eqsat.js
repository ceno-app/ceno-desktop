// Keep eQsatExtractorErrors in sync with eQsatExtractor.sys.mjs
const eQsatExtractorErrors = Object.freeze({
  ZipFileMalformed: "eqsat-error-zip-file-malformed",
  UpdateWithoutBase: "eqsat-error-update-without-base",
  UpdateWithoutBase_FilenameUnknown: "eqsat-error-update-without-base-filename-unknown",
  InvalidFilename: "eqsat-error-invalid-filename",
  PackageTooOld: "eqsat-error-package-too-old",
  PackageTooNew: "eqsat-error-package-too-new",
});

// Keep eQsatExtractorStage in sync with eQsatExtractor.sys.mjs
const eQsatExtractorStage = Object.freeze({
  Idle: 'Idle',
  ParsingZipFile: 'ParsingZipFile',
  Extracting: 'Extracting',
  ProcessingDHTGroups: 'ProcessingDHTGroups',
});

const resultsStorage = new Map();
const zipFileQueueStorage = new Map();

const dom = Object.seal({
  errorTemplate: null,
  dhtPageTemplate: null,
  resultCardTemplate: null,
  zipFilesQueueContainer: null,
  zipFilesQueueTemplate: null,
  activeExtractionFilename: null,
  loadingCard: null,
  noResults: null,
  progressBar: null,
  progressContainer: null,
  parsing: null,
  extracting: null,
  processingDHT: null,
  cancelCurrent: null,
  cancelAll: null,
});

document.addEventListener("DOMContentLoaded", () => {
  const errorTemplateSource = document.getElementById("error-template");
  dom.errorTemplate = errorTemplateSource.content.firstElementChild.cloneNode(true);
  errorTemplateSource.remove();

  const dhtPageTemplateSource = document.getElementById("page-template");
  dom.dhtPageTemplate = dhtPageTemplateSource.content.firstElementChild.cloneNode(true);
  dhtPageTemplateSource.remove();

  const resultCardTemplateSource = document.getElementById("result-template");
  dom.resultCardTemplate = resultCardTemplateSource.content.firstElementChild.cloneNode(true);
  resultCardTemplateSource.remove();

  dom.zipFilesQueueContainer = document.getElementById("zipFilesQueue");
  const zipFilesQueueTemplateSource = document.getElementById("zipFileInQueueTemplate");
  dom.zipFilesQueueTemplate = zipFilesQueueTemplateSource.content.firstElementChild.cloneNode(true);
  zipFilesQueueTemplateSource.remove();

  dom.activeExtractionFilename = document.getElementById("package-file");

  dom.loadingCard = document.getElementById("loading-card");

  dom.noResults = document.getElementById("no-results");
  dom.progressBar = document.getElementById('progress-bar');
  dom.progressContainer = document.getElementById('progressContainer');
  dom.parsing = document.getElementById('parsingZipFile');
  dom.extracting = document.getElementById('extracting');
  dom.processingDHT = document.getElementById('processingDHT');

  dom.cancelCurrent = document.getElementById('cancelCurrent');
  dom.cancelAll = document.getElementById('cancelAll');
  dom.cancelCurrent.addEventListener("click", () => sendAction("cancelCurrentExtraction"));
  dom.cancelAll.addEventListener("click", () => sendAction("cancelAll"));

  Object.freeze(dom);
});

function sendAction(action, payload) {
  document.dispatchEvent(new CustomEvent("eqsat:action", {
    bubbles: true,
    detail: { action, payload },
  }));
}

let nextFrame = null;
let state = null;

const activeExtractionShownValues = Object.freeze({
  extract: Object.seal({
    total: 0,
    processed: 0,
  }),
  progressBar: Object.seal({
    percent: 0,
  }),
});

function updateActiveExtraction(ae) {
  dom.activeExtractionFilename.textContent = ae.filename;
  dom.activeExtractionFilename.title = ae.filepath;

  const activeStageClass = "active-stage";
  dom.parsing.classList.remove(activeStageClass);
  dom.extracting.classList.remove(activeStageClass);
  dom.processingDHT.classList.remove(activeStageClass);

  if (activeExtractionShownValues.extract.total !== ae.extract.total
    || activeExtractionShownValues.extract.processed !== ae.extract.processed
  ) {
    activeExtractionShownValues.extract.total = ae.extract.total;
    activeExtractionShownValues.extract.processed = ae.extract.processed;
    document.l10n.setAttributes(dom.extracting, "eqsat-extracting", activeExtractionShownValues.extract);
  }
  const progressBarPercentage = ae.extract.total !== 0 ? Math.round(ae.extract.processed / ae.extract.total * 100) : 0;
  if (activeExtractionShownValues.progressBar.percent !== progressBarPercentage) {
    activeExtractionShownValues.progressBar.percent = progressBarPercentage;
    document.l10n.setAttributes(dom.progressBar, "eqsat-progress", activeExtractionShownValues.progressBar);
    dom.progressBar.style.width = progressBarPercentage + '%'
  }
  dom.progressContainer.hidden = true;

  switch (ae.stage) {
    case eQsatExtractorStage.ParsingZipFile:
      dom.parsing.classList.add(activeStageClass);
      break;
    case eQsatExtractorStage.Extracting:
      dom.extracting.classList.add(activeStageClass);
      dom.progressContainer.hidden = false;
      break;
    case eQsatExtractorStage.ProcessingDHTGroups:
      dom.processingDHT.classList.add(activeStageClass);
      break;
  }
}

function syncResultCards(resultIds) {
  const freshIds = new Set(resultIds.map(id => `extracted-package-${id}`));
  for (const el of document.querySelectorAll(".result-card")) {
    if (!freshIds.has(el.id)) {
      el.remove();
    }
  }

  let insertAfterThis = dom.noResults;
  for (const id of resultIds) {
    const item = resultsStorage.get(id);
    if (!item) {
      continue;
    }
    const domId = `extracted-package-${id}`;
    if (document.getElementById(domId)) {
      // New results are added to the front
      // If we already shown this element all the later elements will be shown too
      continue;
    }

    const newResultElement = dom.resultCardTemplate.cloneNode(true);
    newResultElement.id = domId;

    const packageFile = newResultElement.querySelector(".package-file");
    packageFile.textContent = item.zipFileName;
    packageFile.title = item.zipFilePath;

    const errorsContainer = newResultElement.querySelector(".errors");
    for (const err of item.errors) {
      const errorElement = dom.errorTemplate.cloneNode(true);
      if (Object.values(eQsatExtractorErrors).includes(err.error)) {
        document.l10n.setAttributes(errorElement, err.error, { filename: err.file || ""});
      } else {
        errorElement.textContent = (err.file ? err.file + ': ' : '') + err.error;
      }
      errorsContainer.appendChild(errorElement);
    }

    const pagesContainer = newResultElement.querySelector(".pages");
    for (const page of item.dhtGroups) {
      const pageElement = dom.dhtPageTemplate.cloneNode(true);
      const link = pageElement.querySelector("a");
      link.href = page.startsWith("https://") || page.startsWith("http://") ? page : 'https://' + page;
      link.textContent = decodeURI(page);
      pagesContainer.appendChild(pageElement);
    }
    if (item.dhtGroups.length === 0 && item.errors.length === 0) {
      newResultElement.querySelector(".no-pages").hidden = false;
    }

    insertAfterThis.after(newResultElement);
    insertAfterThis = newResultElement;
  }
}

function syncZipFileQueue(zipFileQueueIds) {
  dom.cancelAll.hidden = zipFileQueueIds.length === 0;
  const freshIds = new Set(zipFileQueueIds.map(id => `zipFileInQueue-${id}`));
  for (const el of dom.zipFilesQueueContainer.querySelectorAll(".zipFileInQueue")) {
    if (!freshIds.has(el.id)) {
      el.remove();
    }
  }

  // New items in zipFileQueue are added to the end of the queue
  for (const id of zipFileQueueIds) {
    const domId = `zipFileInQueue-${id}`;
    const item = zipFileQueueStorage.get(id);
    if (!item || document.getElementById(domId)) {
      continue;
    }

    const newQueueElement = dom.zipFilesQueueTemplate.cloneNode(true);
    newQueueElement.id = domId;

    const zqf = newQueueElement.querySelector(".zipQueueFile")
    zqf.textContent = item.fileName || "";
    zqf.title = item.filePath || "";
    const zipQueueRemove = newQueueElement.querySelector(".zipQueueRemove");
    zipQueueRemove.addEventListener("click", () => {
      sendAction("removeFromQueue", { id: item.id });
    });
    document.l10n.setAttributes(zipQueueRemove, "eqsat-queue-remove", {
      filename: item.fileName
    });
    dom.zipFilesQueueContainer.appendChild(newQueueElement);
  }
}

function refresh() {
  // fetch queue items we don't have yet
  const newQueue = state.zipFileIdQueue.filter(id => !zipFileQueueStorage.has(id));
  if (newQueue.length) {
    sendAction("getQueueItemsByIds", { ids: newQueue });
  }

  // fetch results we don't have yet
  const newRes = state.completedResultsIds.filter(id => !resultsStorage.has(id));
  if (newRes.length) {
    sendAction("getResultsByIds", { ids: newRes });
  }

  const ae = state.activeExtraction;
  const isIdle = ae.stage === eQsatExtractorStage.Idle;
  dom.noResults.hidden = !(isIdle && state.completedResultsIds.length === 0);
  dom.loadingCard.hidden = isIdle;
  if (!isIdle) {
    updateActiveExtraction(ae);
  }

  syncResultCards(state.completedResultsIds);
  syncZipFileQueue(state.zipFileIdQueue);
}

function scheduleRefresh() {
  if (nextFrame) return;
  nextFrame = requestAnimationFrame(() => {
    refresh();
    nextFrame = null;
  });
}

document.addEventListener("eqsat:state", e => {
  state = JSON.parse(e.detail);
  scheduleRefresh();
});

document.addEventListener("eqsat:results", e => {
  for (const r of JSON.parse(e.detail)) {
    resultsStorage.set(r.id, r);
  }
  scheduleRefresh();
});

document.addEventListener("eqsat:queue", e => {
  for (const q of JSON.parse(e.detail)) {
    zipFileQueueStorage.set(q.id, q);
  }
  scheduleRefresh();
});
