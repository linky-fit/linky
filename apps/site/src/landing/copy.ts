import type { SiteLocale } from "../sitePreferences";

export type CtaMode = "google-play" | "web" | "zapstore";

export type Screen =
  | "chat-payment"
  | "chat-request"
  | "contacts"
  | "proxy-offer"
  | "recurring-list"
  | "token-share"
  | "wallet";

export interface Feature {
  title: string;
  description: string;
  screen: Screen;
}

export interface TokenSectionCopy {
  title: string;
  description: string;
  messenger: string;
  qrCode: string;
  nfcCard: string;
}

export interface LandingCopy {
  title: string;
  /** The part of `title` set in the accent color. */
  titleAccent: string;
  subtitle: string;
  ctaLabels: Record<CtaMode, string>;
  showAllLabel: string;
  getAppTitle: string;
  featuresTitle: string;
  features: Feature[];
  tokenSection: TokenSectionCopy;
  closingSectionDescription: string;
  closingImageAlt: string;
}

const ctaLabels: Record<CtaMode, string> = {
  "google-play": "Google Play",
  web: "Web app",
  zapstore: "Zapstore",
};

export const copy: Record<SiteLocale, LandingCopy> = {
  cs: {
    showAllLabel: "Zobrazit vše",
    getAppTitle: "Stáhněte si aplikaci",
    title: "Budujte svou bitcoinovou síť",
    titleAccent: "bitcoinovou",
    subtitle:
      "Každou platbou vytváříte a posilujete vztahy s lidmi kolem sebe. S Linky posíláte bitcoin stejně jednoduše jako běžnou zprávu - svým blízkým i komukoliv dalšímu.",
    ctaLabels: { ...ctaLabels, web: "Webová aplikace" },
    featuresTitle: "Funkce",
    features: [
      {
        title: "Posílejte bitcoin stejně jako zprávu",
        description:
          "Vyberete kontakt, zadáte částku a pošlete platbu stejně jakoukoliv zprávu.",
        screen: "chat-payment",
      },
      {
        title: "Vyžádejte si platbu",
        description:
          "Pošlete si žádost o zaplacení přímo v chatu a druhá strana ji může potvrdit jedním klepnutím.",
        screen: "chat-request",
      },
      {
        title: "Převod zaplatí kamarád. Vy mu pošlete bitcoin.",
        description:
          "Naskenujte QR kód bankovního převodu. Nabídku dostane několik vašich přátel, kdo ji přijme první, převod zaplatí ze své banky a vy mu pošlete sats.",
        screen: "proxy-offer",
      },
      {
        title: "Pravidelné platby",
        description:
          "Posílejte kontaktu pevnou částku denně, týdně nebo měsíčně. Linky odešle každou platbu včas, dokud ji nepozastavíte.",
        screen: "recurring-list",
      },
    ],
    tokenSection: {
      title: "Bitcoin i pro lidi bez Linky",
      description:
        "Platbu můžete připravit i pro někoho, kdo ještě žádnou peněženku nemá. Linky mu ji pomůže jednoduše převzít.",
      messenger: "Vložte ho do jakékoliv aplikace na zprávy",
      qrCode: "Ukažte QR kód",
      nfcCard: "Nebo předejte NFC kartu",
    },
    closingSectionDescription:
      "Nepotřebujete telefonní číslo, e-mail ani žádné doklady.",
    closingImageAlt:
      "Ukázka soukromého používání aplikace Linky bez osobních údajů",
  },
  en: {
    showAllLabel: "Show all",
    getAppTitle: "Get the app",
    title: "Build your bitcoin network",
    titleAccent: "bitcoin",
    subtitle:
      "Every payment helps you grow and strengthen your network of people. With Linky, you send bitcoin as easily as a message - to friends, family, or anyone else.",
    ctaLabels,
    featuresTitle: "Features",
    features: [
      {
        title: "Send bitcoin like a message",
        description:
          "Pick a contact, enter an amount, and send money as naturally as sending a chat message.",
        screen: "chat-payment",
      },
      {
        title: "Request a payment",
        description:
          "Send a payment request directly in the chat so the other person can settle it with a single tap.",
        screen: "chat-request",
      },
      {
        title: "A friend pays the transfer. You pay them in bitcoin.",
        description:
          "Scan the QR code of a bank transfer. A few of your friends get the offer, the first to accept pays it from their bank, and you send them sats.",
        screen: "proxy-offer",
      },
      {
        title: "Recurring payments",
        description:
          "Send a contact a fixed amount daily, weekly or monthly. Linky sends every payment on time until you pause it.",
        screen: "recurring-list",
      },
    ],
    tokenSection: {
      title: "Bitcoin for people without Linky",
      description:
        "You can prepare a payment for someone who does not have a wallet yet. Linky makes the handoff simple.",
      messenger: "Paste it into any messenger",
      qrCode: "Show a QR code",
      nfcCard: "Or hand over an NFC card",
    },
    closingSectionDescription:
      "You don't need a phone number, email address, or any identity documents.",
    closingImageAlt:
      "Preview of private Linky usage without personal information",
  },
  de: {
    showAllLabel: "Alle anzeigen",
    getAppTitle: "Hol dir die App",
    title: "Baue dein Bitcoin-Netzwerk auf",
    titleAccent: "Bitcoin-Netzwerk",
    subtitle:
      "Mit jeder Zahlung wächst dein Netzwerk und deine Beziehungen werden stärker. Mit Linky sendest du Bitcoin so einfach wie eine Nachricht – an Freunde, Familie oder alle anderen.",
    ctaLabels: { ...ctaLabels, web: "Web-App" },
    featuresTitle: "Funktionen",
    features: [
      {
        title: "Sende Bitcoin wie eine Nachricht",
        description:
          "Wähle einen Kontakt, gib einen Betrag ein und sende Geld so einfach wie eine Chatnachricht.",
        screen: "chat-payment",
      },
      {
        title: "Fordere eine Zahlung an",
        description:
          "Sende eine Zahlungsanforderung direkt im Chat, damit die andere Person sie mit einem Tippen begleichen kann.",
        screen: "chat-request",
      },
      {
        title: "Ein Freund zahlt die Überweisung. Du zahlst ihm in Bitcoin.",
        description:
          "Scanne den QR-Code einer Banküberweisung. Ein paar deiner Freunde bekommen das Angebot, wer zuerst annimmt, zahlt sie von seinem Konto, und du schickst ihm Sats.",
        screen: "proxy-offer",
      },
      {
        title: "Wiederkehrende Zahlungen",
        description:
          "Sende einem Kontakt täglich, wöchentlich oder monatlich einen festen Betrag. Linky schickt jede Zahlung pünktlich, bis du sie pausierst.",
        screen: "recurring-list",
      },
    ],
    tokenSection: {
      title: "Bitcoin für Menschen ohne Linky",
      description:
        "Du kannst eine Zahlung für jemanden vorbereiten, der noch keine Wallet hat. Linky macht die Übergabe einfach.",
      messenger: "Füge ihn in einen beliebigen Messenger ein",
      qrCode: "Zeig einen QR-Code",
      nfcCard: "Oder gib eine NFC-Karte weiter",
    },
    closingSectionDescription:
      "Du brauchst weder Telefonnummer noch E-Mail-Adresse oder Ausweisdokumente.",
    closingImageAlt:
      "Vorschau der privaten Linky-Nutzung ohne persönliche Daten",
  },
};
