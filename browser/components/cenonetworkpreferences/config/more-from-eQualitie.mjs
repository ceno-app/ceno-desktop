import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

Preferences.addSetting({ id: "promoGroup" });
Preferences.addSetting({ id: "cenoCategoryHeading" });
Preferences.addSetting({ id: "moreFromeQualitie_ProductGrid" });
Preferences.addSetting({ id: "cenoAndroidPlayRow" });
Preferences.addSetting({ id: "cenoAndroidPaskoochehRow" });
Preferences.addSetting({ id: "cenoIosAppstoreRow" });

const CENO_PREFS_ASSETS = "chrome://browser/content/cenonetworkpreferences/";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=ie.equalit.ceno&pcampaignid=ceno-desktop";
const PASKOOCHEH_URL = "https://paskoocheh.com/tools/124/android.html?utm_source=ceno-desktop";
const APP_STORE_URL = "https://apps.apple.com/us/app/ceno-browser/id6673915387";

const products = {
  censorshipResistance: [
    {
      id: "dcomms",
      icon: "dcomms.svg",
      url: "https://dcomms.org/",
    },
    {
      id: "ouisync",
      icon: "ouisync.svg",
      url: "https://ouisync.net/",
    },
    {
      id: "eqsat",
      icon: "eqsat.svg",
      url: "https://sat.equalit.ie/",
    },
  ],
  webSecurity: [
    {
      id: "deflect",
      icon: "deflect.svg",
      url: "https://equalitie.org/portfolio/deflect/",
    },
    {
      id: "baskerville",
      icon: "baskerville.svg",
      url: "https://github.com/equalitie/baskervillehall",
    },
    {
      id: "deflect-labs",
      icon: "deflect-labs.svg",
      url: "https://deflect.ca/solutions/deflect-labs/",
    },
    {
      id: "eqpress",
      icon: "eqpress.svg",
      url: "https://deflect.ca/solutions/hosting/",
    },
  ],
  capacityBuilding: [
    {
      id: "eqtv",
      icon: "eqtv.png",
      url: "https://tv.equalit.ie/",
    },
  ],
};

function cenoCategoryHeading(l10nId) {
  return {
    id: "cenoCategoryHeading",
    control: "h2",
    l10nId,
    controlAttrs: { class: "ceno-category-heading" },
  };
}

function cenoDownloadRow({ id, href, l10nId, qrImage }) {
  let children = [];

  if (qrImage) {
    children.push({
      control: "a",
      controlAttrs: { href, target: "_blank", class: "ceno-dl-qr" },
      options: [
        {
          control: "img",
          l10nId: `${l10nId}-qr`,
          controlAttrs: { src: CENO_PREFS_ASSETS + qrImage },
        },
      ],
    });
  }

  children.push({
    control: "span",
    l10nId,
    controlAttrs: { class: "ceno-dl-caption" },
    options: [
      {
        control: "a",
        controlAttrs: {
          href,
          target: "_blank",
          "data-l10n-name": "download",
        },
      },
    ],
  });

  return {
    id,
    control: "div",
    controlAttrs: {
      class: qrImage ? "ceno-dl-row" : "ceno-dl-row ceno-dl-row--no-qr",
    },
    options: children,
  };
}

function cenoFieldset(l10nId, rows) {
  return {
    id: "promoGroup",
    control: "moz-fieldset",
    l10nId,
    iconSrc: "chrome://branding/content/about-logo.svg",
    controlAttrs: { ".headingLevel": 2 },
    items: rows,
  };
}

function cenoProductCard({ id, icon, url}) {
  return {
    control: "moz-card",
    controlAttrs: { id },
    options: [
      {
        control: "moz-fieldset",
        l10nId: `more-from-equalitie-${id}-card`,
        controlAttrs: { headinglevel: 2 },
      },
      {
        l10nId: `more-from-equalitie-${id}-box-link`,
        control: "moz-box-link",
        controlAttrs: {
          iconsrc: CENO_PREFS_ASSETS + icon,
          layout: "large-icon",
          href: url,
        },
      },
    ],
  };
}

function cenoProductGrid(category) {
  return {
    id: "moreFromeQualitie_ProductGrid",
    control: "div",
    controlAttrs: { class: "products-grid" },
    options: products[category].map(cenoProductCard),
  };
}

SettingGroupManager.registerGroups({
  moreFromeQualitie_CensorshipResistance: {
    card: "never",
    items: [
      cenoCategoryHeading("more-from-equalitie-censorship-resistance"),
    ],
  },
  moreFromeQualitie_Ceno_Android: {
    items: [
      cenoFieldset("more-from-equalitie-ceno-android", [
        cenoDownloadRow({
          id: "cenoAndroidPlayRow",
          href: PLAY_STORE_URL,
          l10nId: "more-from-equalitie-android-google-play",
          qrImage: "qr-google-play.svg",
        }),
        cenoDownloadRow({
          id: "cenoAndroidPaskoochehRow",
          href: PASKOOCHEH_URL,
          l10nId: "more-from-equalitie-android-paskoocheh",
          qrImage: "qr-paskoocheh.svg",
        }),

      ]),
    ],
  },
  moreFromeQualitie_Ceno_iOS: {
    items: [
      cenoFieldset("more-from-equalitie-ceno-iOS", [
        cenoDownloadRow({
          id: "cenoIosAppstoreRow",
          href: APP_STORE_URL,
          l10nId: "more-from-equalitie-ios-app-store",
          qrImage: "qr-app-store.svg",
        }),
      ]),
    ],
  },
  moreFromeQualitie_CensorshipGrid: {
    card: "never",
    items: [cenoProductGrid("censorshipResistance")],
  },

  moreFromeQualitie_WebSecurity: {
    card: "never",
    items: [
      cenoCategoryHeading("more-from-equalitie-web-security"),
      cenoProductGrid("webSecurity"),
    ],
  },

  moreFromeQualitie_CapacityBuilding: {
    card: "never",
    items: [
      cenoCategoryHeading("more-from-equalitie-capacity-building"),
      cenoProductGrid("capacityBuilding"),
    ],
  },
});
