import type { IconName } from "@linky-fit/ui";

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

export interface Story {
  readonly role: string;
  readonly quote: string;
  readonly image: string;
  readonly alt: string;
}

/** Every string on the site; it is Czech only. */
export const copy = {
  nav: {
    home: "Fazole, úvod",
    openApp: "Spustit",
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
        image: "/stories/truhlar.svg",
        alt: "Truhlářská dílna",
      },
      {
        role: "Květinářství",
        quote: "Když někdo nemá hotovost.",
        image: "/stories/kvetinarstvi.svg",
        alt: "Květinářství",
      },
      {
        role: "Restaurace",
        quote: "Šetříme na poplatcích.",
        image: "/stories/restaurace.svg",
        alt: "Prostřený stůl v restauraci",
      },
    ] satisfies Story[],
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

export type SiteCopy = typeof copy;
