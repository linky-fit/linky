import type { IconName } from "@linky-fit/ui";

export interface Point {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
}

export interface ComparisonRow {
  readonly label: string;
  readonly cardTerminal: string;
  readonly fazole: string;
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

/** Every string on the site; it is Czech only. */
export const copy = {
  nav: {
    home: "fazole.fit, úvod",
    label: "Sekce stránky",
    benefits: "Výhody",
    howItWorks: "Jak to funguje",
    tips: "Spropitné",
    wallet: "Peněženka",
    faq: "Otázky",
    openApp: "Otevřít aplikaci",
  },
  hero: {
    eyebrow: "Platební terminál v telefonu",
    titleBefore: "Terminál, který patří ",
    titleAccent: "jen vám",
    subtitle:
      "Zákazník naskenuje QR kód a zaplatí převodem rovnou na váš účet, nebo bitcoinem přes Lightning či Cashu. Bez smlouvy, bez registrace a bez terminálu, stačí telefon. Tržby i historie zůstávají u vás.",
    primaryCta: "Otevřít aplikaci",
    secondaryCta: "Jak to funguje",
    methods: [
      { icon: "Landmark", label: "QR platba" },
      { icon: "Zap", label: "Lightning" },
      { icon: "Bitcoin", label: "Cashu" },
      { icon: "HandCoins", label: "Spropitné" },
    ] satisfies { icon: IconName; label: string }[],
    demoLabel: "Živé demo",
    demoHint: "Zadejte částku a vyzkoušejte si celou platbu.",
  },
  benefits: {
    eyebrow: "Proč fazole.fit",
    title: "Vaše peníze, vaše data",
    body: "Bez poskytovatele plateb a bez smlouvy. Převody jdou rovnou na váš účet a historie plateb zůstává u vás.",
    points: [
      {
        icon: "KeyRound",
        title: "Klíč k datům máte jen vy",
        body: "Tržby a historie se ukládají ve vašem zařízení a mezi zařízeními se synchronizují šifrovaně.",
      },
      {
        icon: "Bitcoin",
        title: "Přijímáte bitcoin",
        body: "Lightning i Cashu z jednoho QR kódu. Platba se potvrdí sama a peníze máte hned v peněžence aplikace.",
      },
      {
        icon: "Landmark",
        title: "Peníze rovnou na účet",
        body: "Převod jde z účtu zákazníka přímo na váš. Nikdo ho nedrží a na výplatu nečekáte.",
      },
      {
        icon: "Smartphone",
        title: "Bez smlouvy a terminálu",
        body: "Stačí telefon nebo tablet, který už máte. Otevřete aplikaci, zadáte název obchodu a můžete začít.",
      },
      {
        icon: "HandCoins",
        title: "Spropitné jedním klepnutím",
        body: "Zákazník si před platbou vybere spropitné a rovnou vidí, kolik zaplatí celkem.",
      },
      {
        icon: "ShieldCheck",
        title: "Otevřený kód",
        body: "Zdrojový kód je veřejný. Kdokoli si může ověřit, co aplikace dělá.",
      },
    ] satisfies Point[],
  },
  how: {
    eyebrow: "Jak to funguje",
    title: "Tři kroky a máte zaplaceno",
    steps: [
      {
        icon: "QrCode",
        title: "Zadejte částku",
        body: "Naťukejte částku na velké klávesnici a stiskněte Požadovat platbu. Zákazník si může přidat spropitné.",
      },
      {
        icon: "ScanLine",
        title: "Zákazník naskenuje QR",
        body: "Bankovní aplikací pro převod, nebo bitcoinovou peněženkou, třeba Linky.",
      },
      {
        icon: "CheckCheck",
        title: "Máte zaplaceno",
        body: "Platba se uloží do historie i se spropitným a s časem zaplacení.",
      },
    ] satisfies Point[],
    bank: {
      title: "Banka",
      pill: "Potvrzujete vy",
      body: "QR platba ve formátu SPD, kterou umí všechny české banky. Peníze jdou rovnou na váš účet. Jakmile je uvidíte, klepněte na Zaplaceno.",
    },
    bitcoin: {
      title: "Bitcoin",
      pill: "Potvrzeno automaticky",
      body: "Lightning i Cashu v jednom QR kódu (BIP-321), pro starší peněženky přepnete na Jen Lightning. Aplikace platbu pozná sama, a když zákazník platí z Linky, ukáže i jeho jméno.",
    },
  },
  tips: {
    eyebrow: "Spropitné",
    title: "Spropitné, které se neztratí",
    body: "Po stisku Požadovat platbu se zákazníka zeptáme, jestli chce přidat spropitné. Na každé dlaždici vidí, kolik zaplatí celkem.",
    points: [
      {
        icon: "HandCoins",
        title: "Procenta, koruny nebo vlastní částka",
        body: "5, 10, 15 nebo 20 %, +20 či +50 Kč, vlastní spropitné na klávesnici, nebo bez spropitného.",
      },
      {
        icon: "QrCode",
        title: "Jedna platba, jeden QR kód",
        body: "Spropitné je součástí částky v QR kódu, ať zákazník platí bankou, nebo bitcoinem.",
      },
      {
        icon: "History",
        title: "Zvlášť v historii",
        body: "U platby vidíte částku, spropitné i celkovou sumu. Nabídku spropitného vypnete jedním přepínačem.",
      },
    ] satisfies Point[],
  },
  audience: {
    eyebrow: "Pro koho",
    title: "Pro každého, kdo prodává osobně",
    body: "Všude, kde zákazník stojí před vámi s telefonem v ruce.",
    points: [
      {
        icon: "Pizza",
        title: "Kavárny a bistra",
        body: "Rychlé markování u pultu a spropitné rovnou v platbě.",
      },
      {
        icon: "Store",
        title: "Obchody a trhy",
        body: "Krámek, stánek nebo farmářský trh. Terminál nosíte v kapse.",
      },
      {
        icon: "Scissors",
        title: "Salony a služby",
        body: "Kadeřnictví, kosmetika, masáže. Zákazník zaplatí na konci návštěvy.",
      },
      {
        icon: "Car",
        title: "Řemeslníci a služby na cestě",
        body: "Zaplaceno hned po práci, přímo u zákazníka.",
      },
    ] satisfies Point[],
  },
  history: {
    eyebrow: "Historie",
    title: "Každá platba na jednom místě",
    body: "Čas, částka, způsob platby a stav. Tržbu za každý den máte sečtenou, převody i bitcoin dohromady.",
    points: [
      {
        icon: "Clock",
        title: "Součet za den",
        body: "Kolik jste dnes přijali, vidíte hned nad seznamem plateb.",
      },
      {
        icon: "User",
        title: "Víte, kdo zaplatil",
        body: "Když zákazník zaplatí Cashu z Linky, uvidíte jeho jméno a fotku z profilu.",
      },
      {
        icon: "QrCode",
        title: "QR kód znovu jedním klepnutím",
        body: "Nedokončenou platbu otevřete z historie a zákazník ji může dokončit.",
      },
    ] satisfies Point[],
  },
  wallet: {
    eyebrow: "Peněženka",
    title: "Bitcoin v peněžence aplikace, vybíráte kdykoli",
    body: "Bitcoin držíte jako Cashu od mincovny. Zůstatek vidíte v satoshi i v korunách a vybíráte ho do Linky, nebo přes Lightning.",
    points: [
      {
        icon: "Send",
        title: "Poslat do Linky",
        body: "Vložte nebo naskenujte profil v Linky a peníze dorazí jako zpráva do chatu.",
      },
      {
        icon: "Zap",
        title: "Výběr přes Lightning",
        body: "Na Lightning adresu nebo fakturu, napsanou, vloženou nebo naskenovanou.",
      },
      {
        icon: "Wallet",
        title: "Celý zůstatek najednou",
        body: "Bez počítání: odejde všechno a poplatek se odečte. Před odesláním vidíte, kolik příjemce dostane.",
      },
    ] satisfies Point[],
  },
  comparison: {
    eyebrow: "Srovnání",
    title: "Proč ne karetní terminál?",
    body: "Karetní terminál potřebuje smlouvu, vlastní hardware a poskytovatel si bere procento z každé platby. fazole.fit nic z toho nepotřebuje.",
    cardTerminal: "Karetní terminál",
    fazole: "fazole.fit",
    rows: [
      {
        label: "Vaše data",
        cardTerminal: "U poskytovatele",
        fazole: "U vás, synchronizovaná šifrovaně",
      },
      {
        label: "Bitcoin",
        cardTerminal: "Ne",
        fazole: "Lightning i Cashu",
      },
      {
        label: "Hardware",
        cardTerminal: "Terminál ke koupi nebo pronájmu",
        fazole: "Telefon, který už máte",
      },
      {
        label: "Smlouva",
        cardTerminal: "S bankou nebo poskytovatelem",
        fazole: "Žádná, stačí otevřít aplikaci",
      },
      {
        label: "Měsíční paušál",
        cardTerminal: "Často ano",
        fazole: "Žádný",
      },
      {
        label: "Poplatky",
        cardTerminal: "1–2 % z každé platby",
        fazole: "Tarif vaší banky, u bitcoinu pár satoshi",
      },
    ] satisfies ComparisonRow[],
    note: "Karty zatím nepřijímáme: zákazník potřebuje bankovní aplikaci nebo bitcoinovou peněženku.",
  },
  privacy: {
    eyebrow: "Soukromí",
    title: "Bez registrace. Šifrovaně. Vaše data.",
    body: "fazole.fit je local-first. Všechno se ukládá ve vašem zařízení a mezi vašimi zařízeními se synchronizuje šifrovaně.",
    points: [
      {
        icon: "User",
        title: "Bez registrace",
        body: "Žádný e-mail, telefon ani heslo. Zadáte název obchodu a můžete začít.",
      },
      {
        icon: "ShieldCheck",
        title: "Šifrovaná synchronizace",
        body: "Server, přes který se zařízení synchronizují, vidí jen zašifrovaná data.",
      },
      {
        icon: "KeyRound",
        title: "Záložní fráze",
        body: "20 slov obnoví obchod, historii i peněženku. V prohlížečích, které to umí, vám ji nabídne uložit do správce hesel; jinak ji najdete v nastavení.",
      },
      {
        icon: "Smartphone",
        title: "Na dalším zařízení",
        body: "Zvolíte Mám záložní frázi, vložíte ji nebo ji doplní správce hesel a obchod se otevře i s historií.",
      },
    ] satisfies Point[],
  },
  faq: {
    eyebrow: "Otázky",
    title: "Časté otázky",
    items: [
      {
        question: "Kolik to stojí?",
        answer:
          "Aplikace je zdarma a z plateb si nic nebere. Převod jde z účtu zákazníka rovnou na váš účet a banka si za něj účtuje to, co za každou příchozí platbu podle vašeho tarifu. U bitcoinu si mincovna Cashu účtuje malé poplatky, obvykle pár satoshi: když platbu přijmete a když peníze vybíráte.",
      },
      {
        question: "Co potřebuje zákazník?",
        answer:
          "Bankovní aplikaci, která umí QR platby (umí to všechny české banky), nebo bitcoinovou peněženku s Lightning či Cashu, třeba Linky.",
      },
      {
        question: "Jak poznám, že platba z banky dorazila?",
        answer:
          "Ověříte si ji ve své bance, třeba podle notifikace. Každá platba má vlastní variabilní symbol, takže ji snadno najdete. Pak klepnete na Zaplaceno. Platbu bitcoinem aplikace pozná sama.",
      },
      {
        question: "Jak funguje spropitné?",
        answer:
          "Po stisku Požadovat platbu si zákazník vybere spropitné, nebo zvolí Bez spropitného. Spropitné je součástí částky v QR kódu a v historii ho uvidíte zvlášť. Když ho nechcete nabízet, vypnete ho v nastavení.",
      },
      {
        question: "Musím mít bankovní účet?",
        answer:
          "Nemusíte. Bez účtu přijímáte jen bitcoin. Číslo účtu můžete zadat hned při založení obchodu, nebo kdykoli později v nastavení.",
      },
      {
        question: "Jak dostanu bitcoin z aplikace?",
        answer:
          "V Peněžence klepnete na Vybrat a zvolíte Poslat do Linky, nebo Lightning. Když nezadáte částku, odejde celý zůstatek a poplatky se odečtou. Před odesláním vidíte, kolik příjemce dostane a jaký je nejvyšší poplatek.",
      },
      {
        question: "Co když ztratím telefon?",
        answer:
          "Na novém zařízení zvolíte Mám záložní frázi a vložíte 20 slov, nebo je doplní správce hesel. Obnoví se obchod, historie i peněženka. Frázi najdete v nastavení aplikace.",
      },
      {
        question: "Co je Lightning a Cashu?",
        answer:
          "Lightning je síť pro rychlé a levné bitcoinové platby. Cashu je digitální hotovost krytá bitcoinem, kterou vydává mincovna a která se posílá jako zpráva. Aplikace přijme obojí z jednoho QR kódu.",
      },
      {
        question: "Funguje to i na tabletu nebo počítači?",
        answer:
          "Ano. fazole.fit je webová aplikace, kterou si z prohlížeče nainstalujete na telefon, tablet i počítač.",
      },
      {
        question: "Je to open source?",
        answer:
          "Ano. fazole.fit stojí na otevřeném kódu Linky, který najdete na GitHubu.",
      },
      {
        question: "Proč zrovna fazole?",
        answer:
          "Fazole se říkalo prvním online penězům na českém internetu. Na ně navazujeme: peníze, které jdou z ruky do ruky. A s fazolemi se počítá snadno.",
      },
    ] satisfies FaqItem[],
  },
  closing: {
    title: "Začněte přijímat platby ještě dnes",
    body: "Otevřete aplikaci a zadejte název obchodu. Číslo účtu přidáte hned, nebo později v nastavení.",
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
    demoData: "Ukázková data, neplaťte",
    terminal: {
      amount: "Částka",
      keypadClear: "Vymazat",
      keypadDecimal: ",",
      keypadDelete: "Smazat",
      request: "Požadovat platbu",
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
      qrKind: "Druh QR kódu",
      qrCombined: "Lightning i Cashu",
      qrLightning: "Jen Lightning",
      copyLink: "Kopírovat odkaz",
      copied: "Odkaz zkopírován",
      waiting: "Čekám na platbu…",
      sats: "V bitcoinu",
      rate: "Kurz",
      rateValue: (rate: string) => `1 BTC = ${rate} Kč`,
      bitcoinHint:
        "Zaplaťte z jakékoli Lightning nebo Cashu peněženky, třeba z Linky.",
      autoPay: "V ukázce platba za chvíli dorazí sama.",
    },
    methods: { bank: "Banka", lightning: "Lightning", cashu: "Cashu" },
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
      balance: "Zůstatek",
      withdraw: "Vybrat",
      activity: "Pohyby",
      in: (sats: string) => `+${sats} sat`,
      out: (sats: string) => `−${sats} sat`,
      row: (date: string, label: string) => `${date} · ${label}`,
      rowFee: (row: string, fee: string) => `${row} · poplatek ${fee} sat`,
      withdrawalLightning: "Výběr přes Lightning",
      withdrawalLinky: "Posláno do Linky",
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
      offerTipsDescription: "Před platbou si zákazník může přidat spropitné.",
      security: "Zabezpečení",
      recoverySeed: "Záložní fráze",
      restore: "Obnovit ze zálohy",
      reset: "Resetovat toto zařízení",
      about: "O aplikaci",
      mint: "Mincovna",
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
      tips: "Ukázka výběru spropitného",
      history: "Ukázka historie plateb",
      wallet: "Ukázka peněženky",
      settings: "Ukázka nastavení se záložní frází",
    },
  },
};

export type SiteCopy = typeof copy;
