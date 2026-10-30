import type { Copy } from "./cs";

export const en: Copy = {
  appTagline: "A payment terminal for QR payments by bank or bitcoin.",
  loading: "Loading…",
  back: "Back",
  close: "Close",
  cancel: "Cancel",
  save: "Save",
  retry: "Try again",
  done: "Done",
  czk: "CZK",
  sat: "sat",
  czkAmount: (amount: string) => `${amount} CZK`,
  satAmount: (sats: string) => `${sats} sat`,
  approxCzk: (amount: string) => `≈ ${amount} CZK`,

  welcome: {
    setupShop: "New business",
    restore: "Restore existing",
  },

  setup: {
    title: "Set up a shop",
    description: "You can change these details later in Settings.",
    noShopDescription:
      "No shop belongs to this recovery seed yet. Set one up and start accepting payments.",
    submit: "Continue",
    later: "Set up later",
    failed: "The shop could not be set up. Try again.",
  },

  shopFields: {
    name: "Shop name",
    namePlaceholder: "Linden Tree Café",
    nameHint: "Customers see it in the message for the recipient.",
    nameTooLong: "The name can have at most 100 characters.",
    account: "Account number",
    accountPlaceholder: "2000145399/0800",
    accountValid: (bank: string, iban: string) => `${bank} · ${iban}`,
    accountInvalidFormat:
      "Enter the account as number/bank code, e.g. 2000145399/0800.",
    accountInvalidChecksum:
      "Invalid account number (the checksum does not match). Check for typos.",
    accountUnknownBank: "Unknown bank code.",
  },

  restore: {
    title: "Restore from recovery seed",
    description:
      "Enter the shop's recovery seed. Your password manager can fill it in.",
    field: "Recovery seed",
    paste: "Paste from clipboard",
    pasteFailed:
      "The clipboard could not be read. Paste the seed into the field.",
    invalid: "This is not a valid recovery seed. Check every word.",
    submit: "Restore",
  },

  restoring: {
    title: "Restoring your shop…",
    description:
      "Downloading your data from the sync server. Keep the app open.",
    slowTitle: "Nothing has arrived yet",
    slowDescription:
      "Check your internet connection. If no shop belongs to this seed, there is nothing to restore.",
    startOver: "Start over",
  },

  update: {
    available: "A new version of fazole.fit is available",
    apply: "Update",
  },

  navigation: "Main sections",
  sections: {
    terminal: "Terminal",
    history: "History",
    wallet: "Wallet",
    settings: "Settings",
  },

  terminal: {
    amount: "Amount",
    keypadClear: "Clear",
    keypadDelete: "Delete",
    request: "Confirm",
    failed: "The payment could not be created. Try again.",
    directReceived: "Direct payment",
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
    noAccountTitle: "Bank payments are not set up",
    noAccountDescription:
      "Add a bank account in Settings and customers can pay with a bank QR payment.",
    openSettings: "Open settings",
    paidTitle: "Paid",
    paidFrom: (name: string) => `From: ${name}`,
    notFound: "Payment not found",
    notFoundDescription: "It may not have synced to this device yet.",
    closed: "This payment is no longer open.",
    backToTerminal: "Back to terminal",
    copyLink: "Copy link",
    copied: "Link copied",
    preparing: "Preparing the QR code…",
    waiting: "Waiting for payment…",
    sats: "In bitcoin",
    rateUnavailable: "The bitcoin rate is unavailable",
    mintUnreachable: "The mint is not responding",
    unavailableHint: "Try again, or let the customer pay by bank.",
    minimum: (amount: string) => `Bitcoin from ${amount}`,
    minimumHint:
      "Let the customer pay a smaller amount by bank; mint fees would eat almost all of it.",
    bankUnreachable: "The bank is not responding",
    bankTokenInvalid: "The MONETA token is not valid",
    bankTokenInvalidHint:
      "Create a new one in Internet Banka and paste it in Settings.",
    monetaOfferTitle: "The bank can confirm the payment itself",
    monetaOfferDescription:
      "The account is at MONETA. Add an API token in Settings and the payment shows as paid without tapping Paid.",
  },

  methods: {
    bank: "Bank",
    lightning: "Lightning",
    cashu: "Cashu",
  },

  statuses: {
    pending: "Pending",
    paid: "Paid",
    cancelled: "Cancelled",
  },

  history: {
    emptyTitle: "No payments yet",
    emptyDescription:
      "Payments you create in the terminal and direct payments from Linky show up here.",
    today: "Today",
    yesterday: "Yesterday",
    dayTotal: (amount: string) => `Received ${amount}`,
    row: (...parts: readonly string[]) => parts.join(" · "),
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
    direct: "Direct payment",
    note: "Note",
    directAmount: (sats: string, czk: string | null) =>
      czk === null ? `${sats} sat` : `${sats} sat · ≈ ${czk} CZK`,
    receivedAt: "Received",
    hide: "Delete",
    hideConfirmDescription:
      "It disappears from the history and the day total. The money stays in the wallet.",
  },

  wallet: {
    rateUnavailable: "Rate unavailable",
    switchUnit: "Switch between CZK and sat",
    withdraw: "Withdraw",
    cash: "Cash",
    pledgeButton: (name: string, amount: string) =>
      `Pledge · ${name} · ${amount} CZK left`,
  },

  contact: {
    label: "Contact",
    placeholder: "name",
    invalid: "Enter a Linky name, an address or an npub.",
    notFound: (address: string) => `${address} is not in Linky.`,
    unreachable: "The contact could not be checked. Try again.",
  },

  cash: {
    title: "Cash",
    amount: "Amount",
    amountInvalid: "Enter an amount in CZK.",
    continue: "Continue",
    requested: "Exchange request sent.",
    requestFailed: "The request could not be sent. Try again.",
    offerTitle: (amount: string, name: string) =>
      `${amount} pledge from ${name}`,
    offerDetail: (name: string, available: string | null) =>
      `${available === null ? "The wallet does not hold that much." : `The wallet holds only ${available}.`} ${name} hands you the cash and every bitcoin payment goes to them until the amount is repaid.`,
    createPledge: "Create the pledge",
  },

  pledge: {
    title: "Pledge",
    failed: "The pledge could not be recorded. Try again.",
    openedTitle: (amount: string, name: string) =>
      `${amount} taken as a pledge from ${name}`,
    openedDetail:
      "Every bitcoin payment now goes to this contact until the pledge is repaid.",
    to: "To",
    taken: "Pledge",
    repaid: "Repaid",
    remaining: "Left to repay",
    settling: "The last repayment is on its way.",
  },

  withdraw: {
    title: "Withdraw from wallet",
    target: "Recipient",
    targetPlaceholder: "name, npub or Lightning address",
    targetInvalid:
      "Enter a Linky name, an npub, a Lightning address or an invoice with an amount.",
    invoiceAmount: (sats: string) => `Invoice for ${sats} sat`,
    paste: "Paste from clipboard",
    scan: "Scan QR code",
    scanner: "QR code scanner",
    scannerUnavailable: "The camera is unavailable. Enter it by hand.",
    amount: "Amount",
    amountWhole: "Whole balance, fees deducted",
    amountInvalid: "Enter a whole number of sats.",
    amountHint: (czk: string, sats: string) =>
      `≈ ${czk} CZK · ${sats} sat available`,
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
    pendingTitle: "The payment is processing",
    pendingDetail:
      "The mint has not settled it yet. The balance updates once it does.",
    failures: {
      "lnurl-failed": "The Lightning address did not respond. Check it.",
      "insufficient-funds":
        "The wallet does not hold enough for this and the fee.",
      "amount-too-small": "Fees would eat the whole amount.",
      "mint-unreachable": "The mint is not responding. Try again.",
      "payment-failed": "The payment failed. The money stayed in the wallet.",
    },
  },

  settings: {
    shop: "Shop",
    shopEdit: "Edit shop details",
    shopUnnamed: "Unnamed business",
    offerTips: "Offer tips",
    bitcoinQr: "Bitcoin QR code",
    bitcoinQrModes: {
      universal: "Universal",
      cashu: "Cashu",
      lightning: "Lightning",
    },
    security: "Security",
    recoverySeed: "Recovery seed",
    reset: "Reset this device",
    resetConfirmTitle: "Reset this device?",
    resetConfirmDescription:
      "The shop, history and wallet are deleted from this device. Without the recovery seed they cannot be restored.",
    resetConfirm: "Reset",
    language: "Language",
    about: "About",
    mint: "Mint",
    help: "Help",
    contactSupport: "Contact support",
    unreadSupport: "New reply from support",
    moneta: "Bank payment confirmation",
    monetaOn: "On",
    monetaOff: "Off",
    monetaTitle: "MONETA API",
    monetaDescription:
      "The bank reports a QR payment itself as soon as it reaches the account. In MONETA's Internet Banka open Settings › API token management, create a token for the shop's account with view-only rights and paste it here.",
    monetaToken: "API token",
    monetaConnect: "Connect",
    monetaConnected: (account: string) =>
      `Connected to account ${account}. QR payments are confirmed by themselves.`,
    monetaDisconnect: "Disconnect",
    monetaFailures: {
      "invalid-token": "Paste the whole token.",
      "no-account": "Enter the shop's account number first.",
      unauthorized:
        "The bank did not recognize the token. Check that it is copied whole and still valid.",
      unreachable: "The bank is not responding. Try again.",
      "account-not-visible": (account: string) =>
        `The token does not see account ${account}. Create it for the shop's account.`,
    },
  },
  support: {
    title: "Support",
    emptyTitle: "How can we help?",
    emptyDescription: "Write to us about what you need help with.",
    placeholder: "Message to support",
    send: "Send",
    sending: "Sending",
    failed: "Not sent",
    sendFailed: "The message could not be sent. Try again.",
  },

  shopPicture: {
    title: "Shop picture",
    description:
      "Customers see it in their wallet when they pay you. It is uploaded to a public server.",
    none: "No picture",
    choose: "Choose picture",
    change: "Change picture",
    remove: "Remove picture",
    cropHelp: "Drag the picture to choose the crop.",
    zoom: "Zoom",
    notAnImage: "This file cannot be opened as a picture.",
    failed:
      "The picture could not be saved. Check your connection and try again.",
  },

  recoverySeed: {
    description:
      "The recovery seed is the only backup of the shop, its history and its wallet. Save it in your password manager, or copy it somewhere safe.",
    warning:
      "Never show the seed to anyone. Whoever knows it can access the shop.",
    show: "Show",
    hide: "Hide",
    copy: "Copy",
    copied: "Seed copied. Paste it somewhere safe.",
    copyFailed: "The seed could not be copied.",
    save: "Save to passwords",
    saveRequested: "Confirm saving in the browser's prompt.",
    saveUnavailable:
      "This browser cannot save the seed to a password manager. Copy it instead.",
    saveFailed: "Saving to the password manager failed.",
  },
};
