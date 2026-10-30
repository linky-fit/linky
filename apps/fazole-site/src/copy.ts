import type { IconName } from "@linky-fit/ui";
import type { SiteLocale } from "./sitePreferences";

export interface Point {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
}

/** The screen the phone beside a step shows. */
export type StoryScreenKey = "amount" | "qr" | "paid";

export interface Step {
  readonly title: string;
  readonly body: string;
  readonly screen: StoryScreenKey;
}

/** Who took a story's photo, as its Creative Commons licence asks. */
export interface Credit {
  readonly author: string;
  readonly license: string;
  readonly url: string;
}

export interface Story {
  readonly role: string;
  readonly quote: string;
  readonly image: string;
  readonly alt: string;
}

const cs = {
  nav: {
    home: "Fazole, úvod",
    openApp: "Spustit",
    language: "Jazyk",
    languages: { cs: "Čeština", en: "English" } satisfies Record<
      SiteLocale,
      string
    >,
  },
  hero: {
    titleBefore: "Terminál, který patří ",
    titleAccent: "jen vám",
    subtitle:
      "Zákazník naskenuje QR kód a zaplatí převodem rovnou na váš účet, nebo bitcoinem. Bez smlouvy, bez registrace a bez terminálu. Stačí telefon.",
    primaryCta: "Spustit",
    points: [
      { icon: "Smartphone", label: "Snadné" },
      { icon: "Coins", label: "Zdarma" },
      { icon: "KeyRound", label: "Vaše" },
    ] satisfies { icon: IconName; label: string }[],
    tryIt: "Vyzkoušejte",
    stage: {
      bank: "Bankovní převod",
      bitcoin: "Bitcoin",
    },
  },
  stories: {
    title: "Fazole vám vyroste na míru",
    items: [
      {
        role: "Truhlář",
        quote: "Peníze okamžitě na účet.",
        image: "/stories/truhlar.jpg",
        alt: "Truhlář u pracovního stolu ve své dílně",
      },
      {
        role: "Květinářství",
        quote: "Když někdo nemá hotovost.",
        image: "/stories/kvetinarstvi.jpg",
        alt: "Květinářka s kyticí ve svém obchodě",
      },
      {
        role: "Restaurace",
        quote: "Šetříme na poplatcích.",
        image: "/stories/restaurace.jpg",
        alt: "Číšník nese tác s pitím",
      },
    ] satisfies Story[],
    photos: "Fotografie",
    credits: [
      {
        author: "Jorge Royan",
        license: "CC BY-SA 3.0",
        url: "https://commons.wikimedia.org/wiki/File:Paris_-_Carpenter_workshop_-_4980.jpg",
      },
      {
        author: "direct2Florist",
        license: "CC BY 2.0",
        url: "https://commons.wikimedia.org/wiki/File:Florist_working_in_flower_shop.jpg",
      },
      {
        author: "Florian Plag",
        license: "CC BY 2.0",
        url: "https://commons.wikimedia.org/wiki/File:Waiter_in_a_restaurant,_Paris_2011.jpg",
      },
    ] satisfies Credit[],
  },
  steps: {
    title: "Jak to funguje",
    items: [
      {
        title: "Zadáte částku",
        body: "Naťukáte, kolik to dělá. Zákazník si může přidat spropitné.",
        screen: "amount",
      },
      {
        title: "Zákazník naskenuje a zaplatí",
        body: "Bankovní aplikací, nebo bitcoinovou peněženkou. Obojí z jednoho QR kódu.",
        screen: "qr",
      },
      {
        title: "Peníze dorazí na váš účet",
        body: "Rovnou z banky zákazníka do té vaší, bez prostředníka. S účtem u MONETY se o zaplacení dozvíte okamžitě.",
        screen: "paid",
      },
    ] satisfies Step[],
  },
  why: {
    title: "Vaše peníze, vaše data",
    points: [
      {
        icon: "KeyRound",
        title: "Data jsou jenom vaše",
        body: "My o vás nic nevíme. Tržby i historie zůstávají ve vašem telefonu.",
      },
      {
        icon: "Landmark",
        title: "Peníze jdou okamžitě přímo na váš účet",
        body: "Nikdo je cestou nedrží a na výplatu nečekáte.",
      },
      {
        icon: "Coins",
        title: "Začínáme, všechno je zdarma",
        body: "Bez paušálu a bez provize z plateb.",
      },
      {
        icon: "Bitcoin",
        title: "Proč přijímat i bitcoin?",
        body: "Je to další nástroj ochrany vašeho soukromí a úspor. Zároveň vám přivede pár nových zákazníků. Kurzové riziko nést nemusíte: místo bitcoinu můžete dostávat hotovost.",
      },
    ] satisfies Point[],
  },
  closing: {
    title: "Začněte přijímat platby ještě dnes",
    body: "Spustíte aplikaci, zadáte název obchodu a můžete začít.",
  },
  contact: {
    title: "Napište nám",
    body: "Nechte nám e-mail nebo telefon a ozveme se.",
    channel: "Jak se vám máme ozvat?",
    email: "E-mail",
    phone: "Telefon",
    emailLabel: "Váš e-mail",
    phoneLabel: "Vaše telefonní číslo",
    emailInvalid: "Zadejte platný e-mail.",
    phoneInvalid: "Zadejte telefonní číslo.",
    message: "Zpráva",
    messagePlaceholder: "Na co se chcete zeptat nebo co chystáte?",
    submit: "Ozvěte se mi",
    sentTitle: "Díky, máme to.",
    sentBody: "Brzy se vám ozveme.",
    failed: "Zprávu se nepodařilo odeslat. Zkuste to znovu.",
    privacy: "Vaše údaje použijeme jen k tomu, abychom se vám ozvali.",
  },
  footer: {
    tagline: "Platební terminál pro české obchodníky.",
    linky: "Linky",
    github: "GitHub",
  },
  demo: {
    shopName: "Kavárna U Lípy",
    navigation: "Hlavní sekce",
    sections: {
      terminal: "Terminál",
      history: "Historie",
      wallet: "Peněženka",
      settings: "Nastavení",
    },
    back: "Zpět",
    close: "Zavřít",
    done: "Hotovo",
    czk: "Kč",
    sat: "sat",
    czkAmount: (amount: string) => `${amount} Kč`,
    satAmount: (sats: string) => `${sats} sat`,
    approxCzk: (amount: string) => `≈ ${amount} Kč`,
    terminal: {
      amount: "Částka",
      keypadClear: "Vymazat",
      keypadDecimal: ",",
      keypadDelete: "Smazat",
      request: "Potvrdit",
    },
    tips: {
      title: "Chcete přidat spropitné?",
      base: (amount: string) => `Částka ${amount}`,
      percent: (percent: number) => `${percent} %`,
      fixed: (amount: string) => `+${amount} Kč`,
      custom: "Vlastní spropitné",
      customHint: "Zadat částku",
      none: "Bez spropitného",
      customTotal: (amount: string) => `Celkem ${amount}`,
      confirm: "Potvrdit",
    },
    payment: {
      title: "Platba",
      method: "Způsob platby",
      bank: "Banka",
      bitcoin: "Bitcoin",
      bankQr: (amount: string) => `QR kód pro platbu ${amount} z banky`,
      bitcoinQr: (amount: string) => `QR kód pro platbu ${amount} bitcoinem`,
      vs: "Variabilní symbol",
      account: "Účet",
      recipient: "Příjemce",
      markPaid: "Zaplaceno",
      cancel: "Zrušit platbu",
      paidTitle: "Zaplaceno",
      paidFrom: (name: string) => `Od: ${name}`,
      copyLink: "Kopírovat odkaz",
      copied: "Odkaz zkopírován",
      waiting: "Čekám na platbu…",
      sats: "V bitcoinu",
      preparing: "Připravuji QR kód…",
      rateUnavailable: "Kurz bitcoinu není dostupný",
      unavailable: "Bitcoinový QR kód se nepodařilo připravit",
      unavailableHint:
        "Zkuste to znovu, nebo nechte zákazníka zaplatit bankou.",
      retry: "Zkusit znovu",
    },
    methods: { bank: "Banka", lightning: "Bitcoin", cashu: "Bitcoin" },
    statuses: { pending: "Čeká", paid: "Zaplaceno", cancelled: "Zrušeno" },
    history: {
      today: "Dnes",
      yesterday: "Včera",
      dayTotal: (amount: string) => `Přijato ${amount}`,
      row: (time: string, method: string) => `${time} · ${method}`,
      tipped: (tip: string) => `z toho spropitné ${tip}`,
      amount: "Částka",
      tip: "Spropitné",
      total: "Celkem",
      qrShown: "QR kód",
      detail: "Detail platby",
      method: "Způsob platby",
      created: "Vytvořeno",
      paidAt: "Zaplaceno",
      showQr: "Zobrazit QR kód",
    },
    wallet: {
      rateUnavailable: "Kurz není dostupný",
      switchUnit: "Přepnout mezi Kč a sat",
      withdraw: "Vybrat",
      cash: "Hotovost",
    },
    cash: {
      title: "Hotovost",
      contact: "Kontakt",
      contactPlaceholder: "jmeno",
      amount: "Částka",
      amountInvalid: "Zadejte částku v korunách.",
      continue: "Pokračovat",
      requested: "Žádost o směnu odeslána.",
    },
    withdraw: {
      title: "Vybrat z peněženky",
      chooseLinky: "Poslat do Linky",
      chooseLinkyDescription: "Na profil v Linky jako zprávu s penězi.",
      chooseLightning: "Lightning",
      chooseLightningDescription: "Na Lightning adresu nebo fakturu.",
      linkyRecipient: "Profil v Linky",
      linkyRecipientPlaceholder: "npub1…",
      linkyRecipientHint: "npub, nprofile nebo odkaz na profil v Linky",
      linkyRecipientInvalid: "Tohle není profil v Linky.",
      lightningTarget: "Lightning adresa nebo faktura",
      lightningTargetPlaceholder: "jmeno@domena.cz",
      lightningTargetInvalid: "Zadejte Lightning adresu.",
      paste: "Vložit ukázkový údaj",
      scan: "Naskenovat ukázkový QR kód",
      amount: "Částka",
      amountWhole: "Celý zůstatek, poplatky se odečtou",
      amountInvalid: "Zadejte celé číslo satoshi.",
      insufficient: "V peněžence na to není dost peněz i s poplatkem.",
      available: (sats: string) => `K dispozici ${sats} sat`,
      review: "Zkontrolovat",
      to: "Komu",
      receives: "Příjemce dostane",
      fee: "Poplatek nejvýš",
      total: "Celkem nejvýš",
      submit: "Odeslat",
      sentTitle: "Odesláno",
      sentDetail: (sats: string) => `${sats} sat odešlo z peněženky.`,
      linkySentDetail: (sats: string) => `${sats} sat dorazí do chatu v Linky.`,
    },
    settings: {
      shop: "Obchod",
      offerTips: "Nabízet spropitné",
      bitcoinQr: "Bitcoinový QR kód",
      bitcoinQrUniversal: "Univerzální",
      mint: "Mincovna",
      help: "Pomoc",
      contactSupport: "Kontaktovat podporu",
      about: "O aplikaci",
      language: "Jazyk",
      languageValue: "Čeština",
      security: "Zabezpečení",
      recoverySeed: "Záložní fráze",
      reset: "Resetovat toto zařízení",
      version: "26.10.4",
    },
    recoverySeed: {
      description:
        "Záložní fráze je jediná záloha obchodu, jeho historie i peněženky. Uložte si ji do správce hesel, nebo ji zkopírujte na bezpečné místo.",
      warning: "Frázi nikomu neukazujte. Kdo ji zná, má přístup k obchodu.",
      show: "Zobrazit",
      hide: "Skrýt",
      save: "Uložit do hesel",
      demoNote: "V ukázce jsou to vymyšlená slova.",
    },
    labels: {
      terminal: "Živé demo terminálu",
      amountStep: "Terminál se zadanou částkou",
      qrStep: "QR kód k zaplacení",
      paidStep: "Terminál s přijatou platbou",
    },
  },
};

export type SiteCopy = typeof cs;
export type DemoCopy = SiteCopy["demo"];

const en: SiteCopy = {
  nav: {
    home: "Fazole, home",
    openApp: "Start",
    language: "Language",
    languages: { cs: "Čeština", en: "English" },
  },
  hero: {
    titleBefore: "A terminal that is ",
    titleAccent: "yours alone",
    subtitle:
      "The customer scans a QR code and pays by bank transfer straight to your account, or in bitcoin. No contract, no sign-up, no terminal. A phone is enough.",
    primaryCta: "Start",
    points: [
      { icon: "Smartphone", label: "Easy" },
      { icon: "Coins", label: "Free" },
      { icon: "KeyRound", label: "Yours" },
    ],
    tryIt: "Try it",
    stage: {
      bank: "Bank transfer",
      bitcoin: "Bitcoin",
    },
  },
  stories: {
    title: "Fazole grows to fit you",
    items: [
      {
        role: "Carpenter",
        quote: "Money straight to my account, at once.",
        image: "/stories/truhlar.jpg",
        alt: "A carpenter at the bench in his workshop",
      },
      {
        role: "Flower shop",
        quote: "For when someone has no cash.",
        image: "/stories/kvetinarstvi.jpg",
        alt: "A florist holding a bouquet in her shop",
      },
      {
        role: "Restaurant",
        quote: "We save on fees.",
        image: "/stories/restaurace.jpg",
        alt: "A waiter carrying a tray of drinks",
      },
    ],
    photos: "Photos",
    credits: cs.stories.credits,
  },
  steps: {
    title: "How it works",
    items: [
      {
        title: "Enter the amount",
        body: "Type what it comes to. The customer can add a tip.",
        screen: "amount",
      },
      {
        title: "The customer scans and pays",
        body: "With a banking app, or a bitcoin wallet. Both from one QR code.",
        screen: "qr",
      },
      {
        title: "The money lands in your account",
        body: "Straight from the customer's bank to yours, with nobody in between. With a MONETA account you learn of the payment at once.",
        screen: "paid",
      },
    ],
  },
  why: {
    title: "Your money, your data",
    points: [
      {
        icon: "KeyRound",
        title: "The data is yours alone",
        body: "We know nothing about you. Takings and history stay on your phone.",
      },
      {
        icon: "Landmark",
        title: "Money goes straight to your account, at once",
        body: "Nobody holds it on the way and you never wait for a payout.",
      },
      {
        icon: "Coins",
        title: "We are starting out, everything is free",
        body: "No monthly fee and no cut of your payments.",
      },
      {
        icon: "Bitcoin",
        title: "Why take bitcoin too?",
        body: "One more way to protect your privacy and savings. It also brings a few new customers. You need not carry the exchange risk: instead of bitcoin you can take cash.",
      },
    ],
  },
  closing: {
    title: "Start taking payments today",
    body: "Start the app, name your shop and you are ready.",
  },
  contact: {
    title: "Write to us",
    body: "Leave us an email or a phone number and we will get back to you.",
    channel: "How should we reach you?",
    email: "Email",
    phone: "Phone",
    emailLabel: "Your email",
    phoneLabel: "Your phone number",
    emailInvalid: "Enter a valid email.",
    phoneInvalid: "Enter a phone number.",
    message: "Message",
    messagePlaceholder: "What would you like to ask, or what are you planning?",
    submit: "Get in touch",
    sentTitle: "Thanks, we have it.",
    sentBody: "We will be in touch soon.",
    failed: "The message could not be sent. Please try again.",
    privacy: "We use your details only to get back to you.",
  },
  footer: {
    tagline: "A payment terminal for Czech merchants.",
    linky: "Linky",
    github: "GitHub",
  },
  demo: {
    shopName: "Kavárna U Lípy",
    navigation: "Main sections",
    sections: {
      terminal: "Terminal",
      history: "History",
      wallet: "Wallet",
      settings: "Settings",
    },
    back: "Back",
    close: "Close",
    done: "Done",
    czk: "CZK",
    sat: "sat",
    czkAmount: (amount: string) => `${amount} CZK`,
    satAmount: (sats: string) => `${sats} sat`,
    approxCzk: (amount: string) => `≈ ${amount} CZK`,
    terminal: {
      amount: "Amount",
      keypadClear: "Clear",
      keypadDecimal: ",",
      keypadDelete: "Delete",
      request: "Confirm",
    },
    tips: {
      title: "Would you like to add a tip?",
      base: (amount: string) => `Amount ${amount}`,
      percent: (percent: number) => `${percent} %`,
      fixed: (amount: string) => `+${amount} CZK`,
      custom: "Custom tip",
      customHint: "Enter an amount",
      none: "No tip",
      customTotal: (amount: string) => `Total ${amount}`,
      confirm: "Confirm",
    },
    payment: {
      title: "Payment",
      method: "Payment method",
      bank: "Bank",
      bitcoin: "Bitcoin",
      bankQr: (amount: string) => `QR code to pay ${amount} by bank`,
      bitcoinQr: (amount: string) => `QR code to pay ${amount} in bitcoin`,
      vs: "Variable symbol",
      account: "Account",
      recipient: "Recipient",
      markPaid: "Paid",
      cancel: "Cancel payment",
      paidTitle: "Paid",
      paidFrom: (name: string) => `From: ${name}`,
      copyLink: "Copy link",
      copied: "Link copied",
      waiting: "Waiting for payment…",
      sats: "In bitcoin",
      preparing: "Preparing the QR code…",
      rateUnavailable: "The bitcoin rate is unavailable",
      unavailable: "The Bitcoin QR code could not be prepared",
      unavailableHint: "Try again, or let the customer pay by bank.",
      retry: "Try again",
    },
    methods: { bank: "Bank", lightning: "Bitcoin", cashu: "Bitcoin" },
    statuses: { pending: "Pending", paid: "Paid", cancelled: "Cancelled" },
    history: {
      today: "Today",
      yesterday: "Yesterday",
      dayTotal: (amount: string) => `Received ${amount}`,
      row: (time: string, method: string) => `${time} · ${method}`,
      tipped: (tip: string) => `incl. ${tip} tip`,
      amount: "Amount",
      tip: "Tip",
      total: "Total",
      qrShown: "QR code",
      detail: "Payment detail",
      method: "Payment method",
      created: "Created",
      paidAt: "Paid",
      showQr: "Show QR code",
    },
    wallet: {
      rateUnavailable: "Rate unavailable",
      switchUnit: "Switch between CZK and sat",
      withdraw: "Withdraw",
      cash: "Cash",
    },
    cash: {
      title: "Cash",
      contact: "Contact",
      contactPlaceholder: "name",
      amount: "Amount",
      amountInvalid: "Enter an amount in CZK.",
      continue: "Continue",
      requested: "Exchange request sent.",
    },
    withdraw: {
      title: "Withdraw from wallet",
      chooseLinky: "Send to Linky",
      chooseLinkyDescription: "To a Linky profile, as a message with money.",
      chooseLightning: "Lightning",
      chooseLightningDescription: "To a Lightning address or invoice.",
      linkyRecipient: "Linky profile",
      linkyRecipientPlaceholder: "npub1…",
      linkyRecipientHint: "npub, nprofile or a link to a Linky profile",
      linkyRecipientInvalid: "This is not a Linky profile.",
      lightningTarget: "Lightning address or invoice",
      lightningTargetPlaceholder: "name@domain.com",
      lightningTargetInvalid: "Enter a Lightning address.",
      paste: "Paste a sample",
      scan: "Scan a sample QR code",
      amount: "Amount",
      amountWhole: "Whole balance, fees deducted",
      amountInvalid: "Enter a whole number of sats.",
      insufficient: "The wallet does not hold enough for this and the fee.",
      available: (sats: string) => `${sats} sat available`,
      review: "Review",
      to: "To",
      receives: "Recipient gets",
      fee: "Fee at most",
      total: "Total at most",
      submit: "Send",
      sentTitle: "Sent",
      sentDetail: (sats: string) => `${sats} sat left the wallet.`,
      linkySentDetail: (sats: string) =>
        `${sats} sat will arrive in the Linky chat.`,
    },
    settings: {
      shop: "Shop",
      offerTips: "Offer tips",
      bitcoinQr: "Bitcoin QR code",
      bitcoinQrUniversal: "Universal",
      mint: "Mint",
      help: "Help",
      contactSupport: "Contact support",
      about: "About",
      language: "Language",
      languageValue: "English",
      security: "Security",
      recoverySeed: "Recovery seed",
      reset: "Reset this device",
      version: cs.demo.settings.version,
    },
    recoverySeed: {
      description:
        "The recovery seed is the only backup of the shop, its history and its wallet. Save it to a password manager or copy it somewhere safe.",
      warning:
        "Show the seed to nobody. Whoever knows it has access to the shop.",
      show: "Show",
      hide: "Hide",
      save: "Save to passwords",
      demoNote: "In the demo these are made-up words.",
    },
    labels: {
      terminal: "Live terminal demo",
      amountStep: "Terminal with an amount entered",
      qrStep: "QR code to pay",
      paidStep: "Terminal with a payment received",
    },
  },
};

/** Every string on the site, by language. */
export const copy: Record<SiteLocale, SiteCopy> = { cs, en };
