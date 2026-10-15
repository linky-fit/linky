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
  continue: "Continue",
  czk: "CZK",
  sat: "sat",
  czkAmount: (amount: string) => `${amount} CZK`,
  satAmount: (sats: string) => `${sats} sat`,
  approxCzk: (amount: string) => `≈ ${amount} CZK`,

  welcome: {
    setupShop: "Set up a shop",
    setupShopDescription: "I want to accept payments in my shop.",
    restore: "I have a recovery seed",
    restoreDescription: "Restore my shop on this device.",
  },

  setup: {
    title: "Set up a shop",
    description:
      "A bank account is optional. Without one you accept bitcoin only. You can change these details later in Settings.",
    noShopDescription:
      "No shop belongs to this recovery seed yet. Set one up and start accepting payments.",
    submit: "Continue",
    failed: "The shop could not be set up. Try again.",
  },

  shopFields: {
    name: "Shop name",
    namePlaceholder: "Linden Tree Café",
    nameHint: "Customers see it in the message for the recipient.",
    nameRequired: "Enter the shop name.",
    account: "Account number (optional)",
    accountPlaceholder: "2000145399/0800",
    accountHint: "In the form [prefix-]number/bank code.",
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
    replaceWarning:
      "Restoring replaces the shop on this device. Without its recovery seed it cannot be brought back.",
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
    directReceived: (name: string, amount: string) =>
      `Direct payment from ${name}: ${amount}`,
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
    qrKind: "QR code type",
    qrCombined: "Lightning and Cashu",
    qrLightning: "Lightning only",
    copyLink: "Copy link",
    copied: "Link copied",
    preparing: "Preparing the QR code…",
    waiting: "Waiting for payment…",
    sats: "In bitcoin",
    rate: "Rate",
    rateValue: (rate: string) => `1 BTC = ${rate} CZK`,
    bitcoinHint: "Pay from any Lightning or Cashu wallet, such as Linky.",
    rateUnavailable: "The bitcoin rate is unavailable",
    mintUnreachable: "The mint is not responding",
    unavailableHint: "Try again, or let the customer pay by bank.",
    minimum: (amount: string) => `Bitcoin from ${amount}`,
    minimumHint:
      "Let the customer pay a smaller amount by bank; mint fees would eat almost all of it.",
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
    hide: "Hide from history",
    hideConfirmDescription:
      "It disappears from the history and the day total. The money stays in the wallet.",
  },

  wallet: {
    balance: "Balance",
    rateUnavailable: "Rate unavailable",
    withdraw: "Withdraw",
    activity: "Activity",
    activityEmptyTitle: "No activity yet",
    activityEmptyDescription: "Bitcoin payments and withdrawals show up here.",
    in: (sats: string) => `+${sats} sat`,
    out: (sats: string) => `−${sats} sat`,
    row: (date: string, label: string) => `${date} · ${label}`,
    rowFee: (row: string, fee: string) => `${row} · fee ${fee} sat`,
    receiptUnassigned: "Unassigned payment",
    receiptPaidAgain: (method: string) => `Paid twice (${method})`,
    withdrawalLightning: "Lightning withdrawal",
    withdrawalLinky: "Sent to Linky",
    pending: "Processing",
    failed: "Failed",
  },

  withdraw: {
    title: "Withdraw from wallet",
    chooseLinky: "Send to Linky",
    chooseLinkyDescription: "To a Linky profile as a message with money.",
    chooseLightning: "Lightning",
    chooseLightningDescription: "To a Lightning address or invoice.",
    linkyRecipient: "Linky profile",
    linkyRecipientPlaceholder: "npub1…",
    linkyRecipientHint: "npub, nprofile or a link to a Linky profile",
    linkyRecipientInvalid: "This is not a Linky profile.",
    lightningTarget: "Lightning address or invoice",
    lightningTargetPlaceholder: "name@domain.com",
    lightningTargetInvalid:
      "Enter a Lightning address or an invoice with an amount.",
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
      "The mint has not settled it yet. You will see the result in Activity.",
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
    offerTips: "Offer tips",
    offerTipsDescription: "Customers can add a tip before paying.",
    noAccount: "No bank account, bitcoin only",
    security: "Security",
    recoverySeed: "Recovery seed",
    restore: "Restore from backup",
    restoreConfirmTitle: "Restore another shop?",
    restoreConfirmDescription:
      "Restoring replaces the shop on this device. Make sure you have its recovery seed before you continue.",
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
