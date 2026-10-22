import { MAX_WATCHERS } from "../domain/watchers";
import type {
  OperatorTransferStatus,
  OnchainTransferDirection,
} from "@linky-fit/onchain-transfer";
import type { Period, TransferOutcome } from "../domain/analytics";
import type { TransferActionFailure } from "../services/transfers";
import type { SendError } from "@linky-fit/linkshu";
import type { LightningFailure } from "../services/lightningPayments";

/** Every user-facing string of the operator console; English only. */
export const copy = {
  appName: "On-chain operator",
  loading: "Opening the account…",
  syncing: "Syncing the account…",
  back: "Back",
  close: "Close",
  navigation: "Sections",
  sections: {
    transfers: "Transfers",
    chats: "Chats",
    wallet: "Wallet",
    stats: "Stats",
    settings: "Settings",
  },
  restore: {
    title: "On-chain operator",
    description:
      "Sign in with the recovery seed of the operator's Linky account. Use an account dedicated to transfers.",
    field: "Recovery seed",
    paste: "Paste",
    pasteFailed: "The browser did not allow reading the clipboard.",
    invalid: "This is not a valid recovery seed.",
    submit: "Sign in",
  },
  direction: {
    send: "On-chain send",
    receive: "On-chain receive",
  } satisfies Record<OnchainTransferDirection, string>,
  status: {
    requested: "Waiting for you",
    accepted: "Accepted",
    denied: "Denied",
    fundsSeen: "Deposit seen",
    fundsReceived: "Funds received",
    completed: "Completed",
    cancelled: "Cancelled",
    refunded: "Refunded",
  } satisfies Record<OperatorTransferStatus | "requested", string>,
  transfers: {
    open: "Open",
    history: "History",
    emptyTitle: "No transfers yet",
    emptyDescription:
      "Requests from Linky users appear here once the on-chain config is published.",
    summary: (direction: string, amount: string) => `${direction} · ${amount}`,
  },
  transfer: {
    title: "Transfer",
    open: "Open transfer",
    notFound: "This transfer is not on this device (yet).",
    amount: "User sends",
    fee: "Service fee",
    receive: "User gets",
    user: "User",
    userNpub: "User npub",
    openChat: "Open chat",
    status: "Status",
    requestedAt: "Requested",
    payoutAddress: "Payout address",
    depositAddress: "Deposit address",
    addressIndex: (index: number) => `Receive index ${index}`,
    refund: "Refund",
    refundToSender: "To the address the deposit came from",
    refundToAddress: (address: string) => `To ${address}`,
    received: "Received",
    confirmations: (count: number, required: number) =>
      `${count} of ${required} confirmations`,
    depositTx: "Deposit transaction",
    payoutTx: "Payout transaction",
    refundTx: "Refund transaction",
    paymentRequest: "Your payment request",
    reason: "Reason",
    userCancelled: (at: string) => `The user asked to cancel at ${at}.`,
    userCancelledFundsMoved:
      "Funds already moved, so the transfer stays open; settle it in the chat.",
    short: (received: string, amount: string) =>
      `Only ${received} arrived instead of ${amount}. Refund it or settle it in the chat.`,
    extra: (received: string, amount: string) =>
      `${received} arrived instead of ${amount}. The user gets only the transfer amount; settle the rest in the chat.`,
    sharedAddress:
      "Another transfer was given the same deposit address, so its deposit is not watched. Cancel one of them and settle any deposit in the chat.",
    accept: "Accept",
    deny: "Deny",
    cancel: "Cancel transfer",
    reasonField: "Reason for the user (optional)",
    waitingForEcash: "Waiting for the user to pay your payment request.",
    waitingForDeposit:
      "Watching the deposit address; it is checked every 20 seconds.",
    checkNow: "Check now",
    payoutTitle: "Pay the user",
    payoutDescription: (amount: string) =>
      `Send ${amount} to the payout address from your wallet, then paste the transaction id. You pay the miner fee.`,
    payoutQr: "Payout payment URI",
    txidField: "Transaction id",
    confirmPayout: "Confirm payout",
    sendEcash: (amount: string) => `Send ${amount} Cashu`,
    sendEcashHint:
      "Pays the user's payment request at the mint; the transfer completes once the message reaches a relay.",
    refundEcash: (amount: string) => `Refund ${amount} Cashu`,
    refundEcashHint:
      "Sends the received Cashu back to the user in the chat; the transfer ends refunded.",
    refundTitle: "Refund the deposit",
    refundDescription:
      "Pay the deposit back from your wallet, then paste the transaction id.",
    confirmRefund: "Confirm refund",
    copy: "Copy",
    copied: "Copied",
    viewInExplorer: "View in the explorer",
  },
  stats: {
    period: "Period",
    periods: {
      allTime: "All time",
      thisMonth: "This month",
      last30Days: "Last 30 days",
    } satisfies Record<Period, string>,
    volume: "Users got",
    fees: "Service fees earned",
    completed: "Completed transfers",
    sent: "Users sent",
    sentHint: "What users got plus the fees",
    transferCount: "Transfers",
    byDirection: "By direction",
    directionHint: {
      receive: "On-chain → Cashu",
      send: "Cashu → on-chain",
    } satisfies Record<OnchainTransferDirection, string>,
    directionSummary: (hint: string, count: number, fees: string) =>
      `${hint} · ${count} ${count === 1 ? "transfer" : "transfers"} · ${fees} fees`,
    outcomes: "Outcomes",
    outcome: {
      completed: "Completed",
      open: "Open",
      refunded: "Refunded",
      cancelled: "Cancelled",
      denied: "Denied",
    } satisfies Record<TransferOutcome, string>,
    completionRate: (percent: number) =>
      `${percent} % of finished transfers completed.`,
    byMonth: "By month",
    month: "Month",
    monthFee: (fees: string) => `${fees} fees`,
    footnote:
      "Only completed transfers count toward the amounts and fees. Transfers count in the period and month they were requested in, since completion time is not stored. Miner fees you paid for payouts and refunds are not tracked or subtracted.",
  },
  failure: (failure: TransferActionFailure): string => {
    switch (failure.reason) {
      case "unknownTransfer":
        return "This transfer is not on this device.";
      case "notAllowed":
        return "The transfer has moved on; this step no longer applies.";
      case "noProfile":
        return "Save the profile with your xpub first.";
      case "invalidTxid":
        return "A transaction id is 64 hexadecimal characters.";
      case "txUnavailable":
        return "The transaction is not on the Esplora server (yet); try again shortly.";
      case "addressUnchecked":
        return "The Esplora server could not show an unused deposit address; try again shortly.";
      case "txidReused":
        return "Another transfer already settled with this transaction.";
      case "depositShort":
        return "Less than the amount plus the fee arrived; refund it or settle it in the chat.";
      case "txShort":
        return `The transaction pays the address only ${failure.paid} sat.`;
      case "inFlight":
        return "Cashu for this transfer is already on its way.";
      case "noTransport":
        return "The user's payment request names no Nostr transport.";
      case "sendFailed":
        return `The Cashu could not be sent (${failure.detail}).`;
    }
  },
  actionFailed: "That did not work; try again.",
  chats: {
    emptyTitle: "No chats yet",
    emptyDescription:
      "Users who request a transfer or write to you appear here.",
    noMessages: "No messages yet",
    openTransfers: (count: number) => `${count} open`,
    unread: "Unread messages",
    placeholder: "Message",
    send: "Send",
    sending: "Sending",
    failed: "Not sent",
    sendFailed: "The message was not sent; try again.",
    ecash: (amount: string, forTransfer: boolean) =>
      forTransfer ? `Cashu ${amount} for a transfer` : `Cashu ${amount}`,
    foreignEcash: (amount: number, unit: string, mint: string) =>
      `Cashu ${amount} ${unit} at ${mint}: not the transfer mint's sats, so it pays no transfer`,
  },
  wallet: {
    title: "Wallet",
    total: "Balance",
    perMint: "Per mint",
    empty: "No Cashu yet.",
    fundsHint:
      "Sending Cashu for on-chain receives pays from this wallet, so keep Cashu at the transfer mint.",
    sendToken: "Send Cashu",
    payLightning: "Pay over Lightning",
    mint: "Mint",
    amount: "Amount",
    amountInvalid: "A whole number of sats above zero.",
    amountTooHigh: (available: string) =>
      `The mint holds only ${available} in this wallet.`,
    available: (available: string) => `${available} available`,
    noFunds: "The wallet holds no Cashu yet.",
    createToken: "Create token",
    tokenTitle: "Cashu token",
    tokenWarning: "Whoever holds this token can spend it",
    tokenWarningDetail:
      "Hand it only to its recipient. Until they claim it, Take back returns it to the wallet.",
    tokenQr: "Cashu token QR code",
    copyToken: "Copy token",
    copied: "Copied",
    copyFailed: "The browser did not allow copying.",
    done: "Done",
    sendFailed: (tag: SendError["_tag"]): string => {
      switch (tag) {
        case "InsufficientFunds":
          return "The wallet does not hold enough at this mint, fees included.";
        case "AmountConsumedByFee":
          return "The mint's fee would take the whole amount.";
        case "MintUnreachable":
        case "CounterLockTimeout":
          return "The mint is not responding; try again.";
        case "MintRejected":
        case "LockingUnsupported":
          return "The mint refused to create the token.";
      }
    },
    sentTokens: "Sent tokens",
    sentTokensHint:
      "Tokens nobody has claimed yet. Taking one back makes the copy you handed out worthless.",
    sentAt: (mint: string, at: string) => `${mint} · ${at}`,
    showToken: "Show token",
    takeBack: "Take back",
    takenBack: (amount: string) => `${amount} is back in the wallet.`,
    takeBackFailed: {
      claimed: "The recipient already claimed this token.",
      mintUnreachable: "The mint is not responding; try again.",
      failed: "The token could not be taken back; try again.",
    },
    invoiceField: "Invoice or Lightning address",
    invoicePlaceholder: "lnbc… or name@domain",
    paste: "Paste",
    targetInvalid: "Paste a Lightning invoice or a Lightning address.",
    invoiceAmount: (amount: string) => `The invoice asks for ${amount}.`,
    review: "Review",
    to: "To",
    receives: "Recipient gets",
    feeReserve: "Fees at most",
    maxTotal: "At most from the wallet",
    pay: "Pay",
    back: "Back",
    paidTitle: (amount: string) => `Paid ${amount}`,
    paidDetail: (fee: string) =>
      `Lightning and mint fees took ${fee}; the rest of the reserve came back.`,
    pendingTitle: "Payment in flight",
    pendingDetail:
      "The mint has not settled it yet. The Cashu stays reserved; the app checks again on the next start.",
    paymentFailed: (failure: LightningFailure): string => {
      switch (failure.reason) {
        case "lnurlFailed":
          return `The Lightning address gave no invoice (${failure.detail}).`;
        case "invoiceExpired":
          return "The invoice has expired; ask for a new one.";
        case "quoteExpired":
          return "The mint's quote expired; review the payment again.";
        case "insufficientFunds":
          return `The wallet holds ${failure.available} sat at this mint; the payment needs up to ${failure.needed} sat.`;
        case "mintUnreachable":
          return "The mint is not responding; nothing was paid.";
        case "mintRejected":
          return `The mint refused it (${failure.detail}); nothing was paid.`;
        case "paymentFailed":
          return failure.detail === null
            ? "The payment failed; the Cashu stayed in the wallet."
            : `The payment failed (${failure.detail}); the Cashu stayed in the wallet.`;
      }
    },
  },
  settings: {
    account: "Account",
    npub: "Operator npub",
    network: "Network",
    mint: "Mint",
    explorer: "Explorer",
    profile: "Profile",
    profileHint:
      "Saving publishes the on-chain config Linky reads and your Nostr profile name. Fee changes apply to new requests only.",
    name: "Name",
    nameHint: "Linky users see this name on their support chat.",
    nameInvalid: "1 to 100 characters.",
    xpub: "Bitcoin wallet (Taproot account)",
    xpubHint: (prefix: string) =>
      `The ${prefix} or descriptor of a Taproot (BIP86) account, e.g. from Trezor Suite or Sparrow. Each on-chain receive gets a fresh deposit address from it; it cannot spend.`,
    xpubInvalid: (prefix: string) =>
      `Paste the ${prefix} or tr(…) descriptor of a Taproot account.`,
    feePercent: "Service fee",
    feeInvalid: "A percentage from 0 to 100 with up to two decimals.",
    feeUnit: "%",
    paused: "Paused",
    pausedHint: "New requests are denied while paused.",
    description: "Description for users",
    descriptionInvalid: "At most 1000 characters.",
    amounts: "Amounts in sats",
    amountsHint:
      "What the user gets, separated by commas; they send it plus the service fee.",
    amountsInvalid: "Positive whole numbers separated by commas.",
    minClientVersion: "Minimum Linky version",
    minClientVersionHint:
      "Linky versions older than this ask their users to update before transferring. Leave it empty for no minimum.",
    minClientVersionInvalid: "A Linky version like 26.10.7, or nothing.",
    watchers: "Watchers",
    watchersHint:
      "npubs, one per line. Each gets a Linky message whenever a request, a payment or a message waits for you.",
    watchersInvalid: `Up to ${MAX_WATCHERS} npubs, one per line.`,
    save: "Save and publish",
    saved: "Saved and published.",
    savedNotPublished:
      "Saved, but the on-chain config or profile name did not reach a relay; save again to retry.",
    saveFailed: "The profile was not saved.",
    firstAddress: "Deposit address #0",
    firstAddressHint:
      "Compare it with the first receive address of your wallet.",
    signOut: "Sign out",
    signOutTitle: "Sign out of this device?",
    signOutDescription:
      "Everything stored on this device is deleted. The account and its transfers stay synced; restore it from its recovery seed.",
  },
  picture: {
    title: "Profile picture",
    description:
      "Linky users see it on the operator contact. It is uploaded to a public server.",
    choose: "Choose picture",
    change: "Change picture",
    remove: "Remove picture",
    cropHelp: "Drag the picture to choose the crop.",
    zoom: "Zoom",
    notAnImage: "This file cannot be opened as a picture.",
    failed:
      "The picture could not be saved. Check your connection and try again.",
    notPublished:
      "Saved, but the profile did not reach a relay; it is published again on the next start or save.",
  },
} as const;
