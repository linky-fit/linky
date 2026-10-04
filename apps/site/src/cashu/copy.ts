import type { SiteLocale } from "../sitePreferences";

interface LocaleCopy {
  cashuLabel: string;
  cashuOptionDescription: string;
  collapseOptionsLabel: string;
  currencyLabel: string;
  expandOptionsLabel: string;
  invalidToken: string;
  linkyPrimaryAction: string;
  lightningAddressLabel: string;
  lightningOptionDescription: string;
  lightningAddressPlaceholder: string;
  loadingToken: string;
  noTokenLoaded: string;
  openInWalletLabel: string;
  pageTitle: string;
  payoutIntro: string;
  redeemButton: string;
  redeemConfirmed: string;
  redeemFailed: string;
  redeemLnurlComment: string;
  redeemSuccessAddress: string;
  redeeming: string;
  showTokenButton: string;
  spentInfo: string;
  statusSpent: string;
  subtitle: string;
  tokenLabel: string;
  validUnknown: string;
}

export const copy: Record<SiteLocale, LocaleCopy> = {
  cs: {
    cashuLabel: "Cashu",
    cashuOptionDescription: "Nascanujte kód vaší cashu peněženkou",
    collapseOptionsLabel: "Skrýt možnosti ↑",
    currencyLabel: "Jednotky",
    expandOptionsLabel: "Další možnosti ↓",
    invalidToken: "Utraceno",
    linkyPrimaryAction: "Vyzvednout v Linky",
    lightningAddressLabel: "Lightning adresa",
    lightningOptionDescription: "Vyberte prostředky na vaši lightning adresu.",
    lightningAddressPlaceholder: "jmeno@linky.fit",
    loadingToken: "Ověřuji token u mintu…",
    noTokenLoaded:
      "Vlož token ručně nebo otevři stránku rovnou s tokenem v URL.",
    openInWalletLabel: "Otevřít v peněžence",
    pageTitle: "Vytvoř odkaz pro vyzvednutí bitcoinu na lightning adresu",
    payoutIntro:
      "Někdo vám posílá bitcoin. Vyzvednout si ho můžete v aplikaci Linky nebo jakékoliv lightning peněžence",
    redeemButton: "Vybrat na adresu",
    redeemConfirmed: "Hotovo",
    redeemFailed: "Vyzvednutí se nepodařilo.",
    redeemLnurlComment: "Vybráno pomocí Linky",
    redeemSuccessAddress: "Prostředky vybrány na {address}",
    redeeming: "Vyzvedávám…",
    showTokenButton: "Zobrazit token",
    spentInfo: "Už to někdo vybral.",
    statusSpent: "Utraceno",
    subtitle:
      "Vložte existující cashu token a vytvořte odkaz, který můžete poslat svému známému.",
    tokenLabel: "Cashu token",
    validUnknown: "Nepodařilo se načíst token.",
  },
  en: {
    cashuLabel: "Cashu",
    cashuOptionDescription: "Scan the code with your Cashu wallet",
    collapseOptionsLabel: "Hide options ↑",
    currencyLabel: "Units",
    expandOptionsLabel: "Show options ↓",
    invalidToken: "Spent",
    linkyPrimaryAction: "Redeem in Linky",
    lightningAddressLabel: "Lightning address",
    lightningOptionDescription: "Withdraw the funds to your Lightning address.",
    lightningAddressPlaceholder: "name@linky.fit",
    loadingToken: "Checking the token with the mint…",
    noTokenLoaded:
      "Paste a token manually or open the page directly with a token in the URL.",
    openInWalletLabel: "Open in wallet",
    pageTitle: "Create a link to redeem bitcoin to a lightning address",
    payoutIntro:
      "Someone is sending you bitcoin. You can redeem it in the Linky app or in any Lightning wallet.",
    redeemButton: "Redeem to address",
    redeemConfirmed: "Success",
    redeemFailed: "Redeem failed.",
    redeemLnurlComment: "Redeemed with Linky",
    redeemSuccessAddress: "Funds redeemed to {address}",
    redeeming: "Redeeming…",
    showTokenButton: "Show token",
    spentInfo: "Someone already redeemed it.",
    statusSpent: "Spent",
    subtitle:
      "Paste an existing Cashu token and create a link to redeem bitcoin to a lightning address.",
    tokenLabel: "Cashu token",
    validUnknown: "Could not load the token.",
  },
  de: {
    cashuLabel: "Cashu",
    cashuOptionDescription: "Scanne den Code mit deiner Cashu-Wallet",
    collapseOptionsLabel: "Optionen ausblenden ↑",
    currencyLabel: "Einheiten",
    expandOptionsLabel: "Weitere Optionen ↓",
    invalidToken: "Ausgegeben",
    linkyPrimaryAction: "In Linky einlösen",
    lightningAddressLabel: "Lightning-Adresse",
    lightningOptionDescription:
      "Lasse das Guthaben an deine Lightning-Adresse auszahlen.",
    lightningAddressPlaceholder: "name@linky.fit",
    loadingToken: "Token wird beim Mint geprüft…",
    noTokenLoaded:
      "Füge einen Token ein oder öffne die Seite direkt mit einem Token in der URL.",
    openInWalletLabel: "In Wallet öffnen",
    pageTitle:
      "Erstelle einen Link zum Einlösen von Bitcoin an eine Lightning-Adresse",
    payoutIntro:
      "Jemand sendet dir Bitcoin. Du kannst sie in der Linky-App oder jeder Lightning-Wallet einlösen.",
    redeemButton: "An Adresse auszahlen",
    redeemConfirmed: "Erledigt",
    redeemFailed: "Einlösen fehlgeschlagen.",
    redeemLnurlComment: "Mit Linky eingelöst",
    redeemSuccessAddress: "Guthaben an {address} ausgezahlt",
    redeeming: "Wird eingelöst…",
    showTokenButton: "Token anzeigen",
    spentInfo: "Jemand hat ihn bereits eingelöst.",
    statusSpent: "Ausgegeben",
    subtitle:
      "Füge einen vorhandenen Cashu-Token ein und erstelle einen Link, über den Bitcoin an eine Lightning-Adresse ausgezahlt werden können.",
    tokenLabel: "Cashu-Token",
    validUnknown: "Der Token konnte nicht geladen werden.",
  },
};
