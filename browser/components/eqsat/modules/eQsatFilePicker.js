"use strict";

if (!window.eQsatPickZipFiles) {
  window.eQsatPickZipFiles = function() {
    return new window.Promise((resolve) => {
      const fp = window.Cc["@mozilla.org/filepicker;1"].createInstance(window.Ci.nsIFilePicker);

      const bc = window.docShell?.browsingContext;
      if (!bc) {
        resolve(null);
        return;
      }

      const strings = window._eqsatPickerStrings;
      const title = strings?.title ?? "Select eQsat Package Files -- no l10n";
      const filterName = strings?.filter ?? "eQsat Packages -- no l10n";

      fp.init(bc, title, window.Ci.nsIFilePicker.modeOpenMultiple);
      fp.appendFilter(filterName, "*.ceno;*.zip");
      fp.appendFilters(window.Ci.nsIFilePicker.filterAll);

      const callback = {
        done: function(result) {
          if (result === window.Ci.nsIFilePicker.returnOK) {
            const files = [];
            const enumerator = fp.files;
            while (enumerator.hasMoreElements()) {
              files.push(enumerator.getNext().QueryInterface(window.Ci.nsIFile));
            }
            resolve(files);
          } else {
            resolve([]);
          }
        }
      };
      callback.QueryInterface = window.ChromeUtils.generateQI(["nsIFilePickerShownCallback"]);
      fp.open(callback);
    });
  };
}
