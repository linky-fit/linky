export const cs = {
  appTagline: "Platební terminál pro QR platby bankou i bitcoinem.",
  loading: "Načítám…",
  back: "Zpět",
  close: "Zavřít",
  cancel: "Zrušit",
  save: "Uložit",
  retry: "Zkusit znovu",
  done: "Hotovo",
  continue: "Pokračovat",
  czk: "Kč",
  sat: "sat",
  czkAmount: (amount: string) => `${amount} Kč`,
  satAmount: (sats: string) => `${sats} sat`,
  approxCzk: (amount: string) => `≈ ${amount} Kč`,

  welcome: {
    setupShop: "Založit obchod",
    setupShopDescription: "Chci přijímat platby ve svém obchodě.",
    restore: "Mám záložní frázi",
    restoreDescription: "Obnovím obchod na tomto zařízení.",
  },

  setup: {
    title: "Založit obchod",
    description:
      "Bankovní účet je nepovinný. Bez něj přijímáte jen bitcoin. Údaje můžete později změnit v nastavení.",
    noShopDescription:
      "K této záložní frázi zatím nepatří žádný obchod. Založte ho a začněte přijímat platby.",
    submit: "Pokračovat",
    failed: "Obchod se nepodařilo založit. Zkuste to znovu.",
  },

  shopFields: {
    name: "Název obchodu",
    namePlaceholder: "Kavárna U Lípy",
    nameHint: "Zákazník ho uvidí ve zprávě pro příjemce.",
    nameRequired: "Zadejte název obchodu.",
    account: "Číslo účtu (nepovinné)",
    accountPlaceholder: "2000145399/0800",
    accountHint: "Ve tvaru [předčíslí-]číslo/kód banky.",
    accountValid: (bank: string, iban: string) => `${bank} · ${iban}`,
    accountInvalidFormat:
      "Zadejte účet ve tvaru číslo/kód banky, např. 2000145399/0800.",
    accountInvalidChecksum:
      "Neplatné číslo účtu (nesedí kontrolní součet). Zkontrolujte překlepy.",
    accountUnknownBank: "Neznámý kód banky.",
  },

  restore: {
    title: "Obnovit ze záložní fráze",
    description:
      "Vložte záložní frázi obchodu. Správce hesel ji může doplnit sám.",
    field: "Záložní fráze",
    paste: "Vložit ze schránky",
    pasteFailed: "Schránku se nepodařilo přečíst. Vložte frázi do pole.",
    invalid: "Tohle není platná záložní fráze. Zkontrolujte každé slovo.",
    replaceWarning:
      "Obnovou nahradíte obchod na tomto zařízení. Bez jeho záložní fráze ho už nepůjde vrátit.",
    submit: "Obnovit",
  },

  restoring: {
    title: "Obnovuji obchod…",
    description:
      "Stahuji vaše data ze synchronizačního serveru. Nechte aplikaci otevřenou.",
    slowTitle: "Zatím nic nedorazilo",
    slowDescription:
      "Zkontrolujte připojení k internetu. Pokud k této frázi žádný obchod nepatří, není co obnovit.",
    startOver: "Začít znovu",
  },

  update: {
    available: "Je k dispozici nová verze fazole.fit",
    apply: "Aktualizovat",
  },

  navigation: "Hlavní sekce",
  sections: {
    terminal: "Terminál",
    history: "Historie",
    wallet: "Peněženka",
    settings: "Nastavení",
  },

  terminal: {
    amount: "Částka",
    keypadClear: "Vymazat",
    keypadDelete: "Smazat",
    request: "Požadovat platbu",
    failed: "Platbu se nepodařilo vytvořit. Zkuste to znovu.",
    directReceived: (name: string, amount: string) =>
      `Přímá platba od ${name}: ${amount}`,
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
    noAccountTitle: "Platby z banky nejsou nastavené",
    noAccountDescription:
      "Přidejte bankovní účet v Nastavení a zákazníci budou moci platit QR platbou z banky.",
    openSettings: "Otevřít nastavení",
    paidTitle: "Zaplaceno",
    paidFrom: (name: string) => `Od: ${name}`,
    notFound: "Platba nenalezena",
    notFoundDescription: "Možná se ještě nesynchronizovala na toto zařízení.",
    closed: "Tato platba už není otevřená.",
    backToTerminal: "Zpět na terminál",
    qrKind: "Druh QR kódu",
    qrCombined: "Lightning i Cashu",
    qrLightning: "Jen Lightning",
    copyLink: "Kopírovat odkaz",
    copied: "Odkaz zkopírován",
    preparing: "Připravuji QR kód…",
    waiting: "Čekám na platbu…",
    sats: "V bitcoinu",
    rate: "Kurz",
    rateValue: (rate: string) => `1 BTC = ${rate} Kč`,
    bitcoinHint:
      "Zaplaťte z jakékoli Lightning nebo Cashu peněženky, třeba z Linky.",
    rateUnavailable: "Kurz bitcoinu není dostupný",
    mintUnreachable: "Mincovna neodpovídá",
    unavailableHint: "Zkuste to znovu, nebo nechte zákazníka zaplatit bankou.",
    minimum: (amount: string) => `Bitcoinem od ${amount}`,
    minimumHint:
      "Menší částku nechte zaplatit bankou, poplatky mincovny by ji skoro celou spotřebovaly.",
  },

  methods: {
    bank: "Banka",
    lightning: "Lightning",
    cashu: "Cashu",
  },

  statuses: {
    pending: "Čeká",
    paid: "Zaplaceno",
    cancelled: "Zrušeno",
  },

  history: {
    emptyTitle: "Zatím žádné platby",
    emptyDescription:
      "Platby, které vytvoříte v terminálu, i přímé platby z Linky se objeví tady.",
    today: "Dnes",
    yesterday: "Včera",
    dayTotal: (amount: string) => `Přijato ${amount}`,
    row: (...parts: readonly string[]) => parts.join(" · "),
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
    direct: "Přímá platba",
    note: "Poznámka",
    directAmount: (sats: string, czk: string | null) =>
      czk === null ? `${sats} sat` : `${sats} sat · ≈ ${czk} Kč`,
    receivedAt: "Přijato",
  },

  wallet: {
    balance: "Zůstatek",
    rateUnavailable: "Kurz není dostupný",
    withdraw: "Vybrat",
    activity: "Pohyby",
    activityEmptyTitle: "Zatím žádné pohyby",
    activityEmptyDescription: "Platby bitcoinem a výběry se objeví tady.",
    in: (sats: string) => `+${sats} sat`,
    out: (sats: string) => `−${sats} sat`,
    row: (date: string, label: string) => `${date} · ${label}`,
    rowFee: (row: string, fee: string) => `${row} · poplatek ${fee} sat`,
    receiptUnassigned: "Nepřiřazená platba",
    receiptPaidAgain: (method: string) => `Zaplaceno podruhé (${method})`,
    withdrawalLightning: "Výběr přes Lightning",
    withdrawalLinky: "Posláno do Linky",
    pending: "Zpracovává se",
    failed: "Nepovedlo se",
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
    lightningTargetInvalid: "Zadejte Lightning adresu nebo fakturu s částkou.",
    invoiceAmount: (sats: string) => `Faktura na ${sats} sat`,
    paste: "Vložit ze schránky",
    scan: "Naskenovat QR kód",
    scanner: "Čtečka QR kódu",
    scannerUnavailable: "Kamera není dostupná. Vložte údaj ručně.",
    amount: "Částka",
    amountWhole: "Celý zůstatek, poplatky se odečtou",
    amountInvalid: "Zadejte celé číslo satoshi.",
    amountHint: (czk: string, sats: string) =>
      `≈ ${czk} Kč · k dispozici ${sats} sat`,
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
    pendingTitle: "Platba se zpracovává",
    pendingDetail: "Mincovna ji ještě nevyřídila. Výsledek uvidíte v pohybech.",
    failures: {
      "lnurl-failed": "Lightning adresa neodpověděla. Zkontrolujte ji.",
      "insufficient-funds": "V peněžence na to není dost peněz i s poplatkem.",
      "amount-too-small": "Poplatky by spotřebovaly celou částku.",
      "mint-unreachable": "Mincovna neodpovídá. Zkuste to znovu.",
      "payment-failed": "Platba se nepovedla. Peníze zůstaly v peněžence.",
    },
  },

  settings: {
    shop: "Obchod",
    shopEdit: "Upravit údaje obchodu",
    offerTips: "Nabízet spropitné",
    offerTipsDescription: "Před platbou si zákazník může přidat spropitné.",
    noAccount: "Bez bankovního účtu, jen bitcoin",
    security: "Zabezpečení",
    recoverySeed: "Záložní fráze",
    restore: "Obnovit ze zálohy",
    restoreConfirmTitle: "Obnovit jiný obchod?",
    restoreConfirmDescription:
      "Obnova nahradí obchod na tomto zařízení. Než budete pokračovat, ujistěte se, že máte jeho záložní frázi.",
    reset: "Resetovat toto zařízení",
    resetConfirmTitle: "Resetovat toto zařízení?",
    resetConfirmDescription:
      "Z tohoto zařízení se smaže obchod, historie i peněženka. Bez záložní fráze je už nepůjde obnovit.",
    resetConfirm: "Resetovat",
    language: "Jazyk",
    about: "O aplikaci",
    mint: "Mincovna",
    help: "Pomoc",
    contactSupport: "Kontaktovat podporu",
    unreadSupport: "Nová odpověď podpory",
  },
  support: {
    title: "Podpora",
    emptyTitle: "Jak vám můžeme pomoct?",
    emptyDescription: "Napište nám, s čím potřebujete pomoct.",
    placeholder: "Zpráva pro podporu",
    send: "Odeslat",
    sending: "Odesílá se",
    failed: "Neodesláno",
    sendFailed: "Zprávu se nepodařilo odeslat. Zkuste to znovu.",
  },

  shopPicture: {
    title: "Obrázek obchodu",
    description:
      "Zákazníci ho uvidí v peněžence, když vám platí. Nahraje se na veřejný server.",
    none: "Bez obrázku",
    choose: "Vybrat obrázek",
    change: "Změnit obrázek",
    remove: "Odebrat obrázek",
    cropHelp: "Posunutím obrázku vyberte výřez.",
    zoom: "Přiblížení",
    notAnImage: "Tento soubor nejde otevřít jako obrázek.",
    failed:
      "Obrázek se nepodařilo uložit. Zkontrolujte připojení a zkuste to znovu.",
  },

  recoverySeed: {
    description:
      "Záložní fráze je jediná záloha obchodu, jeho historie i peněženky. Uložte si ji do správce hesel, nebo ji zkopírujte na bezpečné místo.",
    warning: "Frázi nikomu neukazujte. Kdo ji zná, má přístup k obchodu.",
    show: "Zobrazit",
    hide: "Skrýt",
    copy: "Kopírovat",
    copied: "Fráze je zkopírovaná. Vložte ji na bezpečné místo.",
    copyFailed: "Frázi se nepodařilo zkopírovat.",
    save: "Uložit do hesel",
    saveRequested: "Uložení potvrďte v nabídce prohlížeče.",
    saveUnavailable:
      "Tento prohlížeč neumí uložit frázi do správce hesel. Zkopírujte ji.",
    saveFailed: "Uložení do správce hesel se nepovedlo.",
  },
};

export type Copy = typeof cs;
