import {
  transactionIdForOperation,
  transactionIdForRestore,
} from "@linky-fit/linksync";
import {
  parseMintUrl,
  planSendMint,
  type MintUrl,
  type ReclaimReport,
  type RestoreProgress,
  type RestoreReport,
  type SendReceipt,
  type TokenTransfer,
  type ValidationReport,
} from "@linky-fit/linkshu";
import {
  CashuTokenText,
  ClientId,
  decodeNpub,
  identityFromNsec,
  OutboxRef,
  PaymentNoticeDraft,
  Pubkey,
  TokenMessageDraft,
} from "@linky-fit/linkstr";
import { Cause, Exit, Option, Result, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { isHiddenTestMint, MAIN_MINT_URL } from "../../../utils/mint";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { nowSeconds } from "../../../utils/time";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { makeLocalId } from "../../../utils/validation";
import { normalizePubkeyHex } from "../../hooks/messages/contactIdentity";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { isSpellingOf } from "../../lib/mintSpelling";
import { visibleWalletBalances } from "../../lib/testMintGate";
import { readCashuTokenMemo } from "../../lib/tokenMessageInfo";
import type { ContactIdentityRowLike } from "../../types/appTypes";
import { linkshuCommandsAtom, type LinkshuCommands } from "../linkshu/commands";
import {
  linkstrCommands,
  type LinkstrCommands,
} from "@linky-fit/linkstr-react";
import { platformAtom } from "../platform";
import { allowTestMintsAtom } from "../session/settings";
import { currentNsecAtom } from "../session/session";
import { defaultMintAtom } from "./defaultMint";
import { walletOpsAtom, type WalletOps } from "./opQueue";
import { logPayStep, paymentLogAtom, type PaymentLog } from "./paymentLog";
import { chatWritesAtom, type ChatWrites } from "../messages/chatWrites";

interface Busy {
  readonly _tag: "Busy";
}
interface Failed {
  readonly _tag: "Failed";
  readonly detail: string;
}

export type IssueTokenOutcome =
  | { readonly _tag: "Issued"; readonly receipt: SendReceipt }
  | { readonly _tag: "Insufficient" }
  | {
      readonly _tag: "Failed";
      readonly detail: string;
      readonly insufficient: boolean;
    }
  | Busy;

export type SendIssuedTokenOutcome =
  | { readonly _tag: "Sent" }
  /** Offline: the message waits in the outbox. */
  | { readonly _tag: "Queued" }
  | { readonly _tag: "InvalidToken" }
  | { readonly _tag: "ContactNotFound" }
  | { readonly _tag: "MissingIdentity" }
  | { readonly _tag: "MissingContactNpub" }
  /** The transfer stayed open; nothing was sent. */
  | { readonly _tag: "NotClosed"; readonly detail: string }
  | Failed;

export type CheckTokenOutcome =
  | { readonly _tag: "Live" }
  | { readonly _tag: "Spent" }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "Unknown" }
  | Busy;

export type TransferUpdateOutcome =
  | { readonly _tag: "Done" }
  /** The transfer is no longer in a state this update applies to (a retry pass took a deferred receive over). */
  | { readonly _tag: "InvalidTransition"; readonly detail: string }
  | Failed;

export type RecoverTokensOutcome =
  | { readonly _tag: "NothingToScan" }
  | {
      readonly _tag: "Reclaimed";
      readonly report: ReclaimReport;
      readonly incomplete: boolean;
    }
  | {
      readonly _tag: "Restored";
      readonly restore: RestoreReport;
      readonly reclaim: ReclaimReport;
      readonly incomplete: boolean;
    }
  | Failed;

export type RecoverMode = "missing" | "reclaim" | "all";

interface StartedOptions {
  /** Runs once the wallet queue admitted the operation. */
  readonly onStarted?: () => void;
}

export interface TokensCommands {
  /** A bearer token for QR or share, claim-watched as `issued`. */
  readonly issueToken: (
    args: { readonly amountSat: number; readonly memo: string | null },
    options?: StartedOptions,
  ) => Promise<IssueTokenOutcome>;
  /**
   * Sends an issued token to a contact as a chat message. The transfer is
   * closed first (the message carries the funds now); `onClosed` runs then.
   */
  readonly sendIssuedToken: (args: {
    readonly transfer: TokenTransfer | null;
    readonly contact: ContactIdentityRowLike;
    readonly onClosed?: () => void;
  }) => Promise<SendIssuedTokenOutcome>;
  /** NUT-07 check of one transfer; dropped while another wallet operation runs. */
  readonly checkToken: (
    operationId: string,
    options?: StartedOptions,
  ) => Promise<CheckTokenOutcome>;
  readonly checkAllTokens: (
    options?: StartedOptions,
  ) => Promise<
    { readonly _tag: "Checked"; readonly report: ValidationReport } | Busy
  >;
  /** Issued transfers the recipient claimed, closed; concurrent callers share one check. */
  readonly checkIssuedClaims: () => Promise<{
    readonly claimed: ReadonlyArray<{ amount: number; id: string }>;
  }>;
  readonly reclaimTransfer: (
    operationId: string,
  ) => Promise<
    { readonly _tag: "Reclaimed"; readonly report: ReclaimReport } | Failed
  >;
  /**
   * Restores from the seed (`missing`), reclaims handed-out tokens
   * (`reclaim`) or both over `mints` (`all`), then lets
   * `recoverEnvelopes` check the recurring payment envelopes.
   */
  readonly recoverTokens: (
    args: {
      readonly mode: RecoverMode;
      readonly mints: ReadonlyArray<MintUrl>;
      readonly onProgress: (progress: RestoreProgress) => void;
      readonly recoverEnvelopes: () => Promise<void>;
    },
    options?: StartedOptions,
  ) => Promise<RecoverTokensOutcome>;
  readonly returnToWallet: (
    operationId: string,
  ) => Promise<TransferUpdateOutcome>;
  readonly markIssued: (operationId: string) => Promise<TransferUpdateOutcome>;
  readonly markExternalized: (
    operationId: string,
  ) => Promise<TransferUpdateOutcome>;
  /** Closes a transfer the user is done with; never a refund. */
  readonly forget: (operationId: string) => Promise<TransferUpdateOutcome>;
}

export interface TokensDeps {
  readonly allowTestMints: boolean;
  readonly chat: Pick<
    ChatWrites,
    "appendLocalNostrMessage" | "updateLocalNostrMessage"
  >;
  readonly defaultMint: string | null;
  readonly currentNsec: string | null;
  readonly isOnline: () => boolean;
  readonly linkshu: Pick<
    LinkshuCommands,
    | "cashuTransferLifecycle"
    | "checkAllCashuTokens"
    | "checkCashuTransfer"
    | "readWalletBalances"
    | "reclaimCashuTokens"
    | "restoreCashuTokens"
    | "sendCashuToken"
  >;
  readonly linkstr: Pick<
    LinkstrCommands,
    "enqueueOutbox" | "sendPaymentNotice"
  >;
  readonly logPaymentEvent: PaymentLog["logPaymentEvent"];
  readonly ops: Pick<WalletOps, "runExclusiveTask" | "runQueuedTask">;
}

const BUSY: Busy = { _tag: "Busy" };
const DONE = { _tag: "Done" } as const;
const isPubkey = Schema.is(Pubkey);
const decodeCashuTokenText = Schema.decodeUnknownResult(CashuTokenText);

const describeError = (error: unknown): string =>
  describeTaggedCashuError(error) ?? getUnknownErrorMessage(error, "unknown");

/**
 * The mints a recovery scans: every mint the wallet, the mint list or this
 * device ever knew, minus deleted and hidden test mints; the production and
 * default mints are always scanned.
 */
export const restoreCandidates = ({
  allowTestMints,
  defaultMint,
  isMintDeleted,
  knownMints,
}: {
  readonly allowTestMints: boolean;
  readonly defaultMint: string | null;
  readonly isMintDeleted: (mint: string) => boolean;
  readonly knownMints: ReadonlyArray<string>;
}): ReadonlyArray<MintUrl> => {
  const parse = (urls: ReadonlyArray<string>) =>
    urls.flatMap((url) => {
      const mint = parseMintUrl(url);
      return mint === null ? [] : [mint];
    });
  const alwaysInclude = new Set(parse([MAIN_MINT_URL, defaultMint ?? ""]));
  return [...new Set([...parse(knownMints), ...alwaysInclude])].filter(
    (mint) =>
      (alwaysInclude.has(mint) || !isMintDeleted(mint)) &&
      !isHiddenTestMint(mint, allowTestMints),
  );
};

export const makeTokensCommands = (deps: TokensDeps): TokensCommands => {
  const { linkshu, logPaymentEvent, ops } = deps;
  const lifecycle = linkshu.cashuTransferLifecycle;

  const update =
    (
      run: (
        operationId: string,
      ) => Promise<Result.Result<unknown, { readonly _tag: string }>>,
    ) =>
    async (operationId: string): Promise<TransferUpdateOutcome> => {
      try {
        const outcome = await run(operationId);
        if (Result.isSuccess(outcome)) return DONE;
        const detail = describeError(outcome.failure);
        return outcome.failure._tag === "InvalidTransferTransition"
          ? { _tag: "InvalidTransition", detail }
          : { _tag: "Failed", detail };
      } catch (error) {
        return { _tag: "Failed", detail: describeError(error) };
      }
    };
  const forget = update(lifecycle.forget);

  const issueToken: TokensCommands["issueToken"] = async (
    { amountSat, memo },
    options,
  ) => {
    const logFailure = (error: string, mint: string | null) =>
      logPaymentEvent({
        direction: "out",
        status: "error",
        amount: amountSat,
        fee: null,
        mint,
        unit: "sat",
        error,
        contactId: null,
        method: "unknown",
        phase: "swap",
      });
    const issued = await ops.runExclusiveTask(
      async (): Promise<IssueTokenOutcome> => {
        options?.onStarted?.();
        try {
          const balances = visibleWalletBalances(
            await linkshu.readWalletBalances(),
            deps.allowTestMints,
          );
          const mint = planSendMint({
            balances: balances.perMint,
            isPreferredMint: isSpellingOf(deps.defaultMint),
            amount: amountSat,
          });
          if (mint === null) return { _tag: "Insufficient" };
          const outcome = await linkshu.sendCashuToken({
            amountSat,
            memo,
            mint,
            produceAs: "issued",
          });
          if (Result.isFailure(outcome)) {
            const detail = describeError(outcome.failure);
            logFailure(detail, mint);
            return {
              _tag: "Failed",
              detail,
              insufficient: outcome.failure._tag === "InsufficientFunds",
            };
          }
          const receipt = outcome.success;
          logPaymentEvent({
            direction: "out",
            status: "ok",
            transactionId: transactionIdForOperation(receipt.operationId),
            amount: receipt.amount,
            details: { issuedToken: receipt.tokenText },
            fee: null,
            mint: receipt.mint,
            note: memo,
            unit: receipt.unit,
            error: null,
            contactId: null,
            method: "unknown",
            phase: "swap",
          });
          return { _tag: "Issued", receipt };
        } catch (error) {
          const detail = getUnknownErrorMessage(error, "unknown");
          logFailure(detail, null);
          return { _tag: "Failed", detail, insufficient: false };
        }
      },
    );
    return Option.getOrElse(issued, () => BUSY);
  };

  const sendIssuedToken: TokensCommands["sendIssuedToken"] = async ({
    transfer,
    contact,
    onClosed,
  }) => {
    const { chat } = deps;
    const tokenText = transfer?.tokenText ?? "";
    if (!transfer || !tokenText) return { _tag: "InvalidToken" };
    const contactId = (contact.id ?? "").trim();
    if (!contactId) return { _tag: "ContactNotFound" };
    if (!deps.currentNsec) return { _tag: "MissingIdentity" };
    const contactNpub = normalizeNpubIdentifier(contact.npub ?? "");
    const contactPubHex =
      normalizePubkeyHex(contact.unknownPubkeyHex) ??
      (contactNpub ? decodeNpub(contactNpub) : null);
    if (!contactPubHex || !isPubkey(contactPubHex))
      return { _tag: "MissingContactNpub" };

    const logSent = (phase: "complete" | "publish") =>
      logPaymentEvent({
        amount: transfer.amount,
        contactId,
        details: { usedInputTokens: [tokenText] },
        direction: "out",
        error: null,
        fee: null,
        method: "cashu_chat",
        mint: transfer.mint,
        note: readCashuTokenMemo(tokenText),
        paymentType: "contact",
        phase,
        status: "ok",
        transactionId: transactionIdForOperation(transfer.id),
        unit: transfer.unit,
      });

    try {
      const identity = identityFromNsec(deps.currentNsec);
      if (!identity) throw new Error("invalid nsec");
      const token = decodeCashuTokenText(tokenText);
      if (Result.isFailure(token)) throw new Error("invalid cashu token");
      const clientId = ClientId.make(makeLocalId());
      const pendingId = chat.appendLocalNostrMessage({
        contactId,
        direction: "out",
        content: tokenText,
        wrapId: `pending:${clientId}`,
        rumorId: null,
        pubkey: identity.pubkey,
        createdAtSec: nowSeconds(),
        status: "pending",
        clientId,
      }).id;
      if (!pendingId) throw new Error("failed to persist message");

      const closed = await forget(transfer.id);
      if (closed._tag !== "Done")
        return { _tag: "NotClosed", detail: closed.detail };
      onClosed?.();

      const exit = await deps.linkstr.enqueueOutbox({
        op: {
          _tag: "chat.token",
          draft: new TokenMessageDraft({
            to: contactPubHex,
            token: token.success,
            clientId,
          }),
        },
        ref: OutboxRef.make(`message:${pendingId}`),
      });
      if (Exit.isFailure(exit))
        return { _tag: "Failed", detail: Cause.pretty(exit.cause) };
      chat.updateLocalNostrMessage(pendingId, {
        createdAtSec: exit.value.sentAt,
        rumorId: exit.value.rumorId,
      });

      if (!deps.isOnline()) {
        logSent("publish");
        return { _tag: "Queued" };
      }

      const noticeClientId = ClientId.make(makeLocalId());
      try {
        const noticeExit = await deps.linkstr.sendPaymentNotice(
          new PaymentNoticeDraft({
            to: contactPubHex,
            clientId: noticeClientId,
          }),
        );
        const failure = Exit.isFailure(noticeExit)
          ? Cause.findErrorOption(noticeExit.cause)
          : Option.none();
        logPayStep("payment-notice-publish", {
          anySuccess: Exit.isSuccess(noticeExit),
          clientId: noticeClientId,
          error: Option.isSome(failure) ? failure.value._tag : null,
          wrapId: Exit.isSuccess(noticeExit)
            ? noticeExit.value.recipientCopy.wrapId
            : null,
        });
      } catch (error) {
        logPayStep("payment-notice-publish", {
          anySuccess: false,
          clientId: noticeClientId,
          error: getUnknownErrorMessage(error, "publish failed"),
          wrapId: null,
        });
      }
      logSent("complete");
      return { _tag: "Sent" };
    } catch (error) {
      return { _tag: "Failed", detail: String(error ?? "unknown") };
    }
  };

  const checkToken: TokensCommands["checkToken"] = async (
    operationId,
    options,
  ) => {
    const checked = await ops.runExclusiveTask(() => {
      options?.onStarted?.();
      return linkshu.checkCashuTransfer(operationId);
    });
    if (Option.isNone(checked)) return BUSY;
    const outcome = checked.value;
    if (Result.isFailure(outcome)) return { _tag: "Unknown" };
    switch (outcome.success.status) {
      case "live":
        return { _tag: "Live" };
      case "spent":
        return { _tag: "Spent" };
      case "unavailable":
        return { _tag: "Unavailable" };
    }
  };

  let issuedCheck: ReturnType<TokensCommands["checkIssuedClaims"]> | null =
    null;
  const checkIssuedClaims: TokensCommands["checkIssuedClaims"] = () => {
    issuedCheck ??= lifecycle
      .checkIssuedClaims()
      .then((report) => ({
        claimed: report.claimed.map((entry) => ({
          amount: entry.amount,
          id: entry.operationId,
        })),
      }))
      .finally(() => {
        issuedCheck = null;
      });
    return issuedCheck;
  };

  const recoverTokens: TokensCommands["recoverTokens"] = (
    { mode, mints, onProgress, recoverEnvelopes },
    options,
  ) =>
    ops.runQueuedTask(async (): Promise<RecoverTokensOutcome> => {
      options?.onStarted?.();
      if (mints.length === 0) return { _tag: "NothingToScan" };
      try {
        if (mode !== "missing") {
          const result = await linkshu.reclaimCashuTokens(
            mode === "all" ? mints : undefined,
          );
          if (mode === "all") await recoverEnvelopes();
          return {
            _tag: "Reclaimed",
            report: result.reclaim,
            incomplete:
              result.reclaim.unresolvedProofs.length > 0 ||
              (result.restore?.unavailableMints.length ?? 0) > 0,
          };
        }
        const { restore, reclaim } = await linkshu.restoreCashuTokens(
          mints,
          onProgress,
        );
        await recoverEnvelopes();
        if (reclaim.reclaimedAmount > 0) {
          logPaymentEvent({
            direction: "in",
            status: "ok",
            transactionId: transactionIdForRestore(reclaim.reclaimedProofs),
            amount: reclaim.reclaimedAmount,
            fee: null,
            mint: null,
            unit: "sat",
            error: null,
            contactId: null,
            method: "cashu_restore",
            phase: "restore",
            details: { scannedMints: [...restore.scannedMints] },
          });
        }
        return {
          _tag: "Restored",
          restore,
          reclaim,
          incomplete:
            restore.unavailableMints.length > 0 ||
            reclaim.unresolvedProofs.length > 0,
        };
      } catch (error) {
        return { _tag: "Failed", detail: String(error ?? "unknown") };
      }
    });

  return {
    checkAllTokens: async (options) => {
      const report = await ops.runExclusiveTask(() => {
        options?.onStarted?.();
        return linkshu.checkAllCashuTokens();
      });
      return Option.match(report, {
        onNone: () => BUSY,
        onSome: (checked) => ({ _tag: "Checked", report: checked }) as const,
      });
    },
    checkIssuedClaims,
    checkToken,
    forget,
    issueToken,
    markExternalized: update(lifecycle.markExternalized),
    markIssued: update(lifecycle.markIssued),
    reclaimTransfer: (operationId) =>
      ops.runQueuedTask(async () => {
        try {
          return {
            _tag: "Reclaimed",
            report: await lifecycle.reclaim(operationId),
          } as const;
        } catch (error) {
          return {
            _tag: "Failed",
            detail: getUnknownErrorMessage(error, "unknown"),
          } as const;
        }
      }),
    recoverTokens,
    returnToWallet: update(lifecycle.returnToWallet),
    sendIssuedToken,
  };
};

/** Token issuing, checks, recovery and transfer updates over the current linkshu runtime. */
export const tokensCommandsAtom = Atom.readable((get) =>
  AsyncResult.map(
    AsyncResult.all({
      chat: get(chatWritesAtom),
      linkshu: get(linkshuCommandsAtom),
      paymentLog: get(paymentLogAtom),
    }),
    ({ chat, linkshu, paymentLog }) =>
      makeTokensCommands({
        allowTestMints: get(allowTestMintsAtom),
        chat,
        currentNsec: get(currentNsecAtom),
        defaultMint: get(defaultMintAtom),
        isOnline: get(platformAtom).lifecycle.isOnline,
        linkshu,
        linkstr: linkstrCommands(get.registry),
        logPaymentEvent: paymentLog.logPaymentEvent,
        ops: get(walletOpsAtom),
      }),
  ),
);
