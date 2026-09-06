import {
  type TransactionItem,
  readJsonRecord,
  readStringArrayFromJson,
  readRequestIdFromDetails,
  isPaymentRequestTransaction,
  buildTransactionHistory,
  deriveDeclinedRequestIds,
} from "../app/lib/transactionHistory";
import * as Evolu from "@evolu/common";
import { useQuery } from "@evolu/react";
import { Copy as CompactCopyIcon } from "lucide-react";
import React from "react";
import {
  useAppShellActions,
  useAppShellCore,
} from "../app/context/AppShellContexts";
import { Avatar } from "../components/Avatar";

import { createCashuTokenId } from "../app/lib/cashuTokenIdentity";
import { calculateTransactionHistoryFee } from "../app/lib/transactionHistoryFee";
import { deriveDefaultProfile } from "../derivedProfile";
import { evolu } from "../evolu";
import type { Translate } from "../i18n";
import { getLightningInvoicePreview } from "@linky/linkshu";
import {
  formatInteger,
  getInitials,
  normalizeLocale,
} from "../utils/formatting";
import { asNonEmptyString } from "../utils/validation";

interface ContactSummary {
  id: string;
  lnAddress: string | null;
  name: string | null;
  npub: string | null;
}

interface TransactionDetailValue {
  copyValue?: string;
  value: string;
}

interface TransactionDetailEntry {
  label: string;
  values: TransactionDetailValue[];
}

interface TransactionStatusPill {
  className: string;
  label: string;
}

const TRANSACTION_PAGE_SIZE = 50;

const scoreContact = (contact: ContactSummary): number => {
  let score = 0;
  if (contact.name) score += 4;
  if (contact.npub) score += 2;
  if (contact.lnAddress) score += 1;
  return score;
};

const formatCompactToken = (value: string): string => {
  if (value.length <= 28) return value;
  return `${value.slice(0, 12)}...${value.slice(-12)}`;
};

const formatCompactLongString = (value: string): string => {
  if (value.length <= 20) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const readLnurlSuccessMessage = (item: TransactionItem): string | null => {
  const details = readJsonRecord(item.details);
  if (!details) return null;
  const message = asNonEmptyString(details.lnurlSuccessMessage);
  if (message) return message;
  const url = asNonEmptyString(details.lnurlSuccessUrl);
  if (!url) return null;
  const description = asNonEmptyString(details.lnurlSuccessUrlDescription);
  return description ? `${description} ${url}` : url;
};

const hasTransactionDetails = (
  item: TransactionItem,
  tokenByReferenceId: ReadonlyMap<string, string>,
): boolean => {
  if (
    item.mint ||
    item.error ||
    (item.direction === "out" && item.fee !== null)
  ) {
    return true;
  }

  const details = readJsonRecord(item.details);
  if (!details) return false;

  const hasStoredToken = (
    rawKeys: readonly string[],
    referenceKey: string,
  ): boolean => {
    if (
      rawKeys.some((key) => asNonEmptyString(details[key]) !== null) ||
      readStringArrayFromJson(details[referenceKey]).some((id) =>
        tokenByReferenceId.has(id),
      )
    ) {
      return true;
    }
    return rawKeys.some(
      (key) => readStringArrayFromJson(details[key]).length > 0,
    );
  };

  return (
    hasStoredToken(["usedInputTokens"], "usedTokenIds") ||
    hasStoredToken(["gainedToken", "acceptedToken"], "gainedTokenIds") ||
    [
      details.lightningInvoice,
      details.lightningMemo,
      details.lightningPreimage,
      details.lnurlSuccessMessage,
      details.lnurlSuccessUrl,
    ].some((value) => asNonEmptyString(value) !== null)
  );
};

interface TransactionCardProps {
  buildDetailEntries: (item: TransactionItem) => TransactionDetailEntry[];
  buildProblemStatusPill: (
    item: TransactionItem,
    requestStatus: "declined" | "paid" | "pending" | null,
  ) => TransactionStatusPill | null;
  buildTitle: (item: TransactionItem) => string;
  contactsById: ReadonlyMap<string, ContactSummary>;
  copyText: (text: string) => Promise<void>;
  formatAmountText: (amount: number | null, unit: string | null) => string;
  formatDateText: (createdAtSec: number) => string;
  getRequestStatus: (
    item: TransactionItem,
  ) => "declined" | "paid" | "pending" | null;
  isExpanded: boolean;
  item: TransactionItem;
  nostrPictureByNpub: Readonly<Record<string, string | null>>;
  onToggle: (id: string) => void;
  t: Translate;
  tokenByReferenceId: ReadonlyMap<string, string>;
}

const TransactionCardView = ({
  buildDetailEntries,
  buildProblemStatusPill,
  buildTitle,
  contactsById,
  copyText,
  formatAmountText,
  formatDateText,
  getRequestStatus,
  isExpanded,
  item,
  nostrPictureByNpub,
  onToggle,
  t,
  tokenByReferenceId,
}: TransactionCardProps): React.ReactElement => {
  const contact = item.contactId ? contactsById.get(item.contactId) : null;
  const title = buildTitle(item);
  const generatedPicture = contact?.npub
    ? deriveDefaultProfile(contact.npub).pictureUrl
    : null;
  const pictureUrl =
    (contact?.npub ? nostrPictureByNpub[contact.npub] : null) ||
    generatedPicture;
  const initials = getInitials(contact?.name || title);
  const amountText = formatAmountText(item.amount, item.unit);
  const amountClassName =
    item.direction === "in"
      ? "transaction-amount is-positive"
      : "transaction-amount is-negative";
  const requestStatus = getRequestStatus(item);
  const problemStatusPill = buildProblemStatusPill(item, requestStatus);
  const hasDetails = React.useMemo(
    () => hasTransactionDetails(item, tokenByReferenceId),
    [item, tokenByReferenceId],
  );
  const detailEntries = React.useMemo(
    () => (hasDetails && isExpanded ? buildDetailEntries(item) : []),
    [buildDetailEntries, hasDetails, isExpanded, item],
  );
  const isUnsuccessful =
    requestStatus === "declined" ||
    item.status === "declined" ||
    item.status === "error";
  const lnurlMessage = readLnurlSuccessMessage(item);

  return (
    <div
      className={`transaction-card${hasDetails ? " is-expandable" : ""}${isUnsuccessful ? " is-unsuccessful" : ""}`}
      onClick={() => {
        if (hasDetails) onToggle(item.id);
      }}
      onKeyDown={(event) => {
        if (!hasDetails) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onToggle(item.id);
      }}
      role={hasDetails ? "button" : undefined}
      tabIndex={hasDetails ? 0 : undefined}
    >
      <article className="transaction-row">
        <div className="contact-avatar transaction-avatar" aria-hidden="true">
          {contact ? (
            <Avatar
              pictureUrl={pictureUrl}
              fallback={initials}
              fallbackClassName="contact-avatar-fallback"
              loading="lazy"
            />
          ) : (
            <span className="contact-avatar-fallback transaction-icon-fallback">
              {item.category === "lightning" ? "⚡️" : "🥜"}
            </span>
          )}
        </div>
        <div className="transaction-main">
          <div className="transaction-title">{title}</div>
          {lnurlMessage ? (
            <div className="transaction-subtitle">{lnurlMessage}</div>
          ) : null}
          <div className="transaction-meta">
            <span>{formatDateText(item.createdAtSec)}</span>
            {problemStatusPill ? (
              <span className={problemStatusPill.className}>
                {problemStatusPill.label}
              </span>
            ) : null}
          </div>
        </div>
        <div className={amountClassName}>{amountText || ""}</div>
      </article>
      {detailEntries.length > 0 ? (
        <div className="transaction-detail-panel">
          <dl className="transaction-detail-list">
            {detailEntries.map((field, index) => (
              <React.Fragment key={`${item.id}:${field.label}:${index}`}>
                <dt>{field.label}</dt>
                <dd>
                  <div className="transaction-detail-values">
                    {field.values.map((value, valueIndex) =>
                      value.copyValue ? (
                        <button
                          key={`${item.id}:${field.label}:${index}:${valueIndex}`}
                          type="button"
                          className="copyable transaction-detail-copy"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyText(value.copyValue ?? "");
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                          }}
                          title={t("copy")}
                          aria-label={t("copy")}
                        >
                          <span className="transaction-detail-copyText">
                            {value.value}
                          </span>
                          <span
                            className="transaction-detail-copyIcon"
                            aria-hidden="true"
                          >
                            <CompactCopyIcon size={14} />
                          </span>
                        </button>
                      ) : (
                        <span
                          key={`${item.id}:${field.label}:${index}:${valueIndex}`}
                        >
                          {value.value}
                        </span>
                      ),
                    )}
                  </div>
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
};

const TransactionCard = React.memo(TransactionCardView);

export function TransactionsPage(): React.ReactElement {
  const {
    evoluAppOwnerId,
    evoluTransactionsVisibleOwnerIds,
    formatDisplayedAmountText,
    lang,
    nostrPictureByNpub,
    t,
  } = useAppShellCore();
  const { copyText } = useAppShellActions();
  const [expandedById, setExpandedById] = React.useState<
    Record<string, boolean>
  >({});
  const [visibleCount, setVisibleCount] = React.useState(TRANSACTION_PAGE_SIZE);
  const locale = React.useMemo(() => normalizeLocale(lang), [lang]);

  const contactsQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("contact")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );

  const transactionsQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("transaction")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );

  const cashuTokensQuery = React.useMemo(
    () => evolu.createQuery((db) => db.selectFrom("cashuToken").selectAll()),
    [],
  );

  const nostrMessagesQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("nostrMessage")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );

  const contactRows = useQuery(contactsQuery);
  const cashuTokenRows = useQuery(cashuTokensQuery);
  const nostrMessageRows = useQuery(nostrMessagesQuery);
  const transactionRows = useQuery(transactionsQuery);

  const tokenByReferenceId = React.useMemo(() => {
    const tokens = new Map<string, string>();
    for (const row of cashuTokenRows) {
      for (const candidate of [row.token, row.rawToken]) {
        const token = asNonEmptyString(candidate);
        if (!token) continue;
        tokens.set(createCashuTokenId(token), token);
      }
    }
    return tokens;
  }, [cashuTokenRows]);

  const contactsById = React.useMemo(() => {
    const byId = new Map<string, ContactSummary>();
    for (const row of contactRows) {
      const id = asNonEmptyString(row.id);
      if (!id) continue;
      const candidate: ContactSummary = {
        id,
        lnAddress: asNonEmptyString(row.lnAddress),
        name: asNonEmptyString(row.name),
        npub: asNonEmptyString(row.npub),
      };
      const existing = byId.get(id);
      if (!existing || scoreContact(candidate) >= scoreContact(existing)) {
        byId.set(id, candidate);
      }
    }
    return byId;
  }, [contactRows]);

  const { fulfilledRequestIds, transactions } = React.useMemo(() => {
    return buildTransactionHistory(
      transactionRows,
      evoluAppOwnerId,
      evoluTransactionsVisibleOwnerIds,
    );
  }, [evoluAppOwnerId, evoluTransactionsVisibleOwnerIds, transactionRows]);

  const declinedRequestIds = React.useMemo(
    () => deriveDeclinedRequestIds(nostrMessageRows),
    [nostrMessageRows],
  );
  const visibleTransactions = React.useMemo(
    () => transactions.slice(0, visibleCount),
    [transactions, visibleCount],
  );

  const buildTitle = React.useCallback(
    (item: TransactionItem): string => {
      if (isPaymentRequestTransaction(item)) return t("requestPaymentLabel");
      if (item.note) return item.note;

      const contact = item.contactId ? contactsById.get(item.contactId) : null;
      if (contact) {
        return (
          contact.name ||
          contact.lnAddress ||
          (item.direction === "in"
            ? t("transactionReceivedFromContact")
            : t("transactionSentToContact"))
        );
      }
      if (item.category === "lightning") {
        if (item.direction === "in") {
          return item.method === "lightning_address"
            ? t("transactionTopupLnAddress")
            : t("transactionTopupInvoice");
        }
        return item.method === "lightning_address"
          ? t("transactionPaidLightningAddress")
          : t("transactionPaidLightningInvoice");
      }
      if (item.category === "contacts") {
        return item.direction === "in"
          ? t("transactionReceivedFromContact")
          : t("transactionSentToContact");
      }
      if (item.method === "cashu_receive") return t("transactionCashuInserted");
      if (item.method === "cashu_restore") return t("transactionCashuRestored");
      if (item.method === "cashu_emit" || item.phase === "swap") {
        return t("transactionCashuSwap");
      }
      return t("transactionCashuIssued");
    },
    [contactsById, t],
  );

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  const formatDateText = React.useCallback(
    (createdAtSec: number): string =>
      dateFormatter.format(new Date(createdAtSec * 1000)),
    [dateFormatter],
  );

  const formatAmountText = React.useCallback(
    (amount: number | null, unit: string | null): string => {
      if (amount === null) return "";
      if (unit && unit !== "sat") {
        return `${formatInteger(amount, lang)} ${unit}`;
      }
      return formatDisplayedAmountText(amount);
    },
    [formatDisplayedAmountText, lang],
  );

  const buildProblemStatusPill = React.useCallback(
    (
      item: TransactionItem,
      requestStatus: "declined" | "paid" | "pending" | null,
    ): TransactionStatusPill | null => {
      if (
        requestStatus === "pending" ||
        item.status === "pending" ||
        item.pendingLabel === "pending"
      ) {
        return {
          className: "pill pill-muted transaction-status-pill",
          label: t("transactionPending"),
        };
      }
      if (requestStatus === "declined") {
        return {
          className: "pill pill-error transaction-status-pill",
          label: t("paymentRequestStatusDeclined"),
        };
      }
      if (item.status === "error" || item.status === "declined") {
        return {
          className: "pill pill-error transaction-status-pill",
          label: t("transactionFailed"),
        };
      }
      return null;
    },
    [t],
  );

  const getRequestStatus = React.useCallback(
    (item: TransactionItem): "declined" | "paid" | "pending" | null => {
      if (!isPaymentRequestTransaction(item)) return null;
      const requestId = readRequestIdFromDetails(item.details);
      if (!requestId) return null;
      if (fulfilledRequestIds.has(requestId)) return "paid";
      if (declinedRequestIds.has(requestId)) return "declined";
      return "pending";
    },
    [declinedRequestIds, fulfilledRequestIds],
  );

  const buildDetailEntries = React.useCallback(
    (item: TransactionItem): TransactionDetailEntry[] => {
      const details = readJsonRecord(item.details);
      const legacyUsedTokens = readStringArrayFromJson(
        details?.usedInputTokens,
      );
      const usedTokens = Array.from(
        new Set([
          ...legacyUsedTokens,
          ...readStringArrayFromJson(details?.usedTokenIds).flatMap((id) => {
            const token = tokenByReferenceId.get(id);
            return token ? [token] : [];
          }),
        ]),
      );
      const legacyGainedTokens = [
        asNonEmptyString(details?.gainedToken),
        asNonEmptyString(details?.acceptedToken),
      ].filter((value): value is string => value !== null);
      const gainedTokens = Array.from(
        new Set([
          ...legacyGainedTokens,
          ...readStringArrayFromJson(details?.gainedTokenIds).flatMap((id) => {
            const token = tokenByReferenceId.get(id);
            return token ? [token] : [];
          }),
        ]),
      );
      const fee =
        item.direction === "out"
          ? calculateTransactionHistoryFee({
              amount: item.amount,
              fallbackFee: item.fee,
              gainedTokens,
              usedTokens,
            })
          : null;
      const feeText = fee !== null ? formatAmountText(fee, item.unit) : "";
      const lightningInvoice = asNonEmptyString(details?.lightningInvoice);
      const lightningMemo =
        asNonEmptyString(details?.lightningMemo) ??
        (lightningInvoice
          ? (getLightningInvoicePreview(lightningInvoice)?.description ?? null)
          : null);
      const lightningPreimage = asNonEmptyString(details?.lightningPreimage);
      const lnurlSuccessMessage = asNonEmptyString(
        details?.lnurlSuccessMessage,
      );
      const lnurlSuccessUrl = asNonEmptyString(details?.lnurlSuccessUrl);
      const lnurlSuccessUrlDescription = asNonEmptyString(
        details?.lnurlSuccessUrlDescription,
      );

      return [
        ...(feeText
          ? [
              {
                label: t("paymentsHistoryFee"),
                values: [{ value: feeText }],
              },
            ]
          : []),
        ...(item.mint
          ? [
              {
                label: t("transactionDetailMint"),
                values: [{ value: item.mint }],
              },
            ]
          : []),
        ...(item.error
          ? [
              {
                label: t("transactionDetailError"),
                values: [{ value: item.error }],
              },
            ]
          : []),
        ...(usedTokens.length > 0
          ? [
              {
                label: t("transactionDetailUsedToken"),
                values: usedTokens.map((value) => ({
                  copyValue: value,
                  value: formatCompactToken(value),
                })),
              },
            ]
          : []),
        ...(gainedTokens.length > 0
          ? [
              {
                label: t("transactionDetailGainedToken"),
                values: gainedTokens.map((value) => ({
                  copyValue: value,
                  value: formatCompactToken(value),
                })),
              },
            ]
          : []),
        ...(lnurlSuccessMessage
          ? [
              {
                label: t("transactionDetailLnurlSuccessMessage"),
                values: [{ value: lnurlSuccessMessage }],
              },
            ]
          : []),
        ...(lnurlSuccessUrl
          ? [
              {
                label: t("transactionDetailLnurlSuccessUrl"),
                values: [
                  {
                    value: lnurlSuccessUrlDescription
                      ? `${lnurlSuccessUrlDescription} ${lnurlSuccessUrl}`
                      : lnurlSuccessUrl,
                    copyValue: lnurlSuccessUrl,
                  },
                ],
              },
            ]
          : []),
        ...(lightningMemo
          ? [
              {
                label: t("transactionDetailLightningMemo"),
                values: [{ value: lightningMemo }],
              },
            ]
          : []),
        ...(lightningInvoice
          ? [
              {
                label: t("transactionDetailLightningInvoice"),
                values: [
                  {
                    copyValue: lightningInvoice,
                    value: formatCompactLongString(lightningInvoice),
                  },
                ],
              },
            ]
          : []),
        ...(lightningPreimage
          ? [
              {
                label: t("transactionDetailLightningPreimage"),
                values: [
                  {
                    copyValue: lightningPreimage,
                    value: formatCompactLongString(lightningPreimage),
                  },
                ],
              },
            ]
          : []),
      ];
    },
    [formatAmountText, t, tokenByReferenceId],
  );

  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedById((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  return (
    <section className="panel panel-plain transactions-page">
      {transactions.length === 0 ? (
        <p className="muted">{t("paymentsHistoryEmpty")}</p>
      ) : (
        <>
          <div className="transactions-list">
            {visibleTransactions.map((item) => (
              <TransactionCard
                buildDetailEntries={buildDetailEntries}
                buildProblemStatusPill={buildProblemStatusPill}
                buildTitle={buildTitle}
                contactsById={contactsById}
                copyText={copyText}
                formatAmountText={formatAmountText}
                formatDateText={formatDateText}
                getRequestStatus={getRequestStatus}
                isExpanded={expandedById[item.id] === true}
                item={item}
                key={item.id}
                nostrPictureByNpub={nostrPictureByNpub}
                onToggle={toggleExpanded}
                t={t}
                tokenByReferenceId={tokenByReferenceId}
              />
            ))}
          </div>
          {visibleCount < transactions.length ? (
            <div className="settings-row">
              <button
                type="button"
                className="btn-wide secondary"
                onClick={() =>
                  setVisibleCount((count) => count + TRANSACTION_PAGE_SIZE)
                }
              >
                {t("loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
