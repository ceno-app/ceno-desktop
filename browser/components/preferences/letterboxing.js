/* import-globals-from preferences.js */
/* import-globals-from findInPage.js */

Preferences.addAll([
  {
    id: "privacy.resistFingerprinting.letterboxing",
    type: "bool",
  },
  {
    id: "privacy.resistFingerprinting.letterboxing.rememberSize",
    type: "bool",
  },
  {
    id: "privacy.resistFingerprinting.letterboxing.vcenter",
    type: "bool",
  },
]);

Preferences.addSetting({
  id: "letterboxingEnabled",
  pref: "privacy.resistFingerprinting.letterboxing",
});

Preferences.addSetting({
  id: "letterboxingRememberSize",
  pref: "privacy.resistFingerprinting.letterboxing.rememberSize",
  deps: ["letterboxingEnabled", "resistFingerprinting"],
  visible: ({ letterboxingEnabled, resistFingerprinting }) => {
    return letterboxingEnabled.value && resistFingerprinting.value;
  },
});

Preferences.addSetting({
  id: "letterboxingContentAlignment",
  pref: "privacy.resistFingerprinting.letterboxing.vcenter",
  deps: ["letterboxingEnabled", "resistFingerprinting"],
  visible: ({ letterboxingEnabled, resistFingerprinting }) => {
    return letterboxingEnabled.value && resistFingerprinting.value;
  },
  get: val => {
    return val ? "middle" : "top";
  },
  set: val => {
    return val == "middle";
  },
});

Preferences.addSetting({
  id: "letterboxingShouldEnable",
  deps: ["letterboxingEnabled", "resistFingerprinting"],
  visible: ({ letterboxingEnabled, resistFingerprinting }) => {
    return !letterboxingEnabled.value && resistFingerprinting.value;
  },
  onUserClick: (e, { letterboxingEnabled }) => {
    const buttonEl = document.getElementById("enableLetterboxingButton");
    if (!buttonEl?.contains(e.target)) {
      return;
    }
    letterboxingEnabled.value = true;
    setTimeout(() => {
      // Need to re-search to remove the "hidden" attribute on the groupbox
      // elements (after the data-hidden-from-search attributes are changed by
      // the "visible" callback).
      // TODO: Is this an upstream issue that "hidden" is not removed?
      if (!gSearchResultsPane.query) {
        search(gLastCategory.category, "data-category");
      }
      // Button should have focus when activated but will be hidden now,
      // so re-assign focus to the newly revealed options.
      Services.focus.moveFocus(
        window,
        buttonEl,
        Services.focus.MOVEFOCUS_FORWARD,
        0
      );
    });
  },
});

SettingGroupManager.registerGroups({
  letterboxingDisabled: {
    items: [
      {
        id: "letterboxingShouldEnable",
        l10nId: "letterboxing-disabled-message",
        control: "moz-promo",
        options: [
          {
            control: "moz-button",
            l10nId: "letterboxing-enable-button",
            id: "enableLetterboxingButton",
            slot: "actions",
          },
        ],
      },
    ],
  },
  letterboxingSize: {
    l10nId: "letterboxing-window-size-group",
    headingLevel: 2,
    items: [
      {
        id: "letterboxingRememberSize",
        l10nId: "letterboxing-remember-size",
        control: "moz-checkbox",
      },
    ],
  },
  letterboxingAlignment: {
    l10nId: "letterboxing-alignment-group",
    headingLevel: 2,
    items: [
      {
        id: "letterboxingContentAlignment",
        control: "moz-visual-picker",
        options: [
          {
            value: "top",
            l10nId: "letterboxing-alignment-top-option",
            controlAttrs: {
              class: "setting-chooser-item letterboxing-chooser-item",
              imagesrc:
                "chrome://browser/content/preferences/letterboxing-top.svg",
            },
          },
          {
            value: "middle",
            l10nId: "letterboxing-alignment-middle-option",
            controlAttrs: {
              class: "setting-chooser-item letterboxing-chooser-item",
              imagesrc:
                "chrome://browser/content/preferences/letterboxing-middle.svg",
            },
          },
        ],
      },
    ],
  },
});

var gLetterboxingPrefs = {
  init() {
    const rfpSetting = Preferences.getSetting("resistFingerprinting");
    const updateCategoryVisibility = () => {
      document
        .getElementById("letterboxingCategory")
        .classList.toggle("hide-all-letterboxing", !rfpSetting.value);
    };
    rfpSetting.on("change", updateCategoryVisibility);
    updateCategoryVisibility();
    initSettingGroup("letterboxingDisabled");
    initSettingGroup("letterboxingSize");
    initSettingGroup("letterboxingAlignment");
  },
};
