import { NonEmptyString1000 } from "@linky/linksync";
import { decodeNpub } from "@linky/linkstr";
import { createId, type ContactsRepository } from "@linky/linksync";
import React from "react";
import { ContactId } from "../../evoluIds";
import { navigateTo } from "../../hooks/useRouting";
import { parseLnurlAuthTarget } from "../../lnurlAuth";
import {
  fetchLnurlWithdrawPreview,
  inferLightningAddressFromLnurlTarget,
  isLightningAddress,
  isLnurlPayTarget,
  isLnurlWithdrawTarget,
  LnurlTagMismatchError,
} from "../../lnurlPay";
import { parseBip321Uri, pickBip321PayableLeg } from "../../utils/bip321";
import { parseNativeDeepLinkUrl } from "../../utils/deepLinks";
import {
  getLightningInvoicePreview,
  type LightningInvoicePreview,
} from "@linky/linkshu";
import { isBankPaymentPayload, parseBankPayment } from "@linky/proxy-payment";
import {
  parseCashuPaymentRequestMessage,
  type CashuPaymentRequestMessageInfo,
} from "../lib/paymentRequestMessage";
import { runWrite } from "../lib/storeWrite";
import type { ContactRowLike } from "../types/appTypes";
import type { Translate } from "../../i18n";

interface UseScannedTextHandlerParams<TContact extends ContactRowLike> {
  closeScan: () => void;
  contacts: readonly TContact[];
  currentNpub: string | null;
  extractCashuTokenFromText: (text: string) => string | null;
  contactsRepository: Pick<ContactsRepository, "insert">;
  lightningInvoiceAutoPayLimit: number;
  onContactIdentifierScanned: ((identifier: string) => Promise<void>) | null;
  openScannedContactPendingNpubRef: React.MutableRefObject<string | null>;
  payCashuPaymentRequest: (
    requestInfo: CashuPaymentRequestMessageInfo,
  ) => Promise<void>;
  payLightningInvoiceWithCashu: (invoice: string) => Promise<boolean>;
  requestLightningInvoiceConfirmation: (
    preview: LightningInvoicePreview,
  ) => void;
  requestLnurlAuthConfirmation: (
    preview: import("../../lnurlAuth").LnurlAuthPreview,
  ) => void;
  requestLnurlWithdrawConfirmation: (
    preview: import("../../lnurlPay").LnurlWithdrawPreview,
  ) => void;
  saveCashuFromText: (
    text: string,
    options?: { navigateToTokens?: boolean; navigateToWallet?: boolean },
  ) => Promise<void>;
  scanAcceptsBankPayment: boolean;
  scanEntryPoint: "contacts" | "receive" | "send" | null;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export const useScannedTextHandler = <TContact extends ContactRowLike>({
  closeScan,
  contacts,
  currentNpub,
  extractCashuTokenFromText,
  contactsRepository,
  lightningInvoiceAutoPayLimit,
  onContactIdentifierScanned,
  openScannedContactPendingNpubRef,
  payCashuPaymentRequest,
  payLightningInvoiceWithCashu,
  requestLightningInvoiceConfirmation,
  requestLnurlAuthConfirmation,
  requestLnurlWithdrawConfirmation,
  saveCashuFromText,
  scanAcceptsBankPayment,
  scanEntryPoint,
  setStatus,
  t,
}: UseScannedTextHandlerParams<TContact>) => {
  return React.useCallback(
    async (rawValue: string) => {
      const raw = rawValue.trim();
      if (!raw) return;

      const parsedDeepLink = parseNativeDeepLinkUrl(raw);
      let scanText = (parsedDeepLink?.text ?? raw).trim();

      // BIP 321 / BIP 21 — unified `bitcoin:` URI. The address part is
      // onchain (Linky doesn't settle onchain) so we promote the best
      // available off-chain leg (Cashu request > BOLT11 > LNURL > lightning
      // address) into `scanText` and let the rest of the handler dispatch it
      // through the existing flows. Unrecognized extension params (Ark,
      // silent payments, BOLT12 `lno`) are ignored per spec.
      const bip321 = parseBip321Uri(scanText);
      if (bip321) {
        const leg = pickBip321PayableLeg(bip321);
        if (!leg) {
          setStatus(t("scanUnsupportedBitcoinUri"));
          closeScan();
          return;
        }
        scanText = leg.value;
      }

      if (isBankPaymentPayload(scanText)) {
        if (scanEntryPoint === "receive") {
          setStatus(t("scanReceiveUnsupportedPayment"));
          closeScan();
          return;
        }

        if (!scanAcceptsBankPayment) {
          setStatus(`${t("errorPrefix")}: ${t("scanUnsupported")}`);
          closeScan();
          return;
        }

        try {
          const payment = parseBankPayment(scanText);
          closeScan();
          navigateTo({
            route: "bankPayment",
            spdPayload: payment.payload,
          });
          return;
        } catch (error) {
          const message =
            error instanceof Error && error.message === "spd-missing-account"
              ? t("spdPaymentMissingAccount")
              : t("scanUnsupported");
          setStatus(`${t("errorPrefix")}: ${message}`);
          closeScan();
          return;
        }
      }

      const normalized = scanText
        .replace(/^nostr:/i, "")
        .replace(/^lightning:/i, "")
        .replace(/^cashu:/i, "")
        .trim();

      const cashuPaymentRequest =
        parseCashuPaymentRequestMessage(normalized) ??
        parseCashuPaymentRequestMessage(scanText) ??
        parseCashuPaymentRequestMessage(raw);
      if (cashuPaymentRequest) {
        if (scanEntryPoint === "receive") {
          setStatus(t("scanReceiveUnsupportedPayment"));
          closeScan();
          return;
        }

        closeScan();
        await payCashuPaymentRequest(cashuPaymentRequest);
        return;
      }

      const cashu =
        extractCashuTokenFromText(normalized) ??
        extractCashuTokenFromText(scanText) ??
        extractCashuTokenFromText(raw);
      if (cashu) {
        closeScan();
        await saveCashuFromText(cashu, { navigateToWallet: true });
        return;
      }

      try {
        const pubkey = decodeNpub(normalized);
        if (pubkey) {
          const ownNpub = (currentNpub ?? "").trim();
          if (ownNpub && ownNpub === normalized) {
            setStatus(t("contactIsYou"));
            closeScan();
            navigateTo({ route: "profile" });
            return;
          }

          const already = contacts.some(
            (contact) => (contact.npub ?? "").trim() === normalized,
          );
          if (already) {
            setStatus(t("contactExists"));
            const existing = contacts.find(
              (contact) => (contact.npub ?? "").trim() === normalized,
            );
            closeScan();
            if (existing?.id) {
              navigateTo({
                route: "contact",
                id: ContactId.orThrow(existing.id),
              });
            }
            return;
          }

          if (scanEntryPoint === "contacts" && onContactIdentifierScanned) {
            await onContactIdentifierScanned(normalized);
            closeScan();
            return;
          }

          const result = await runWrite(
            contactsRepository.insert({
              id: createId<"Contact">(),
              npub: NonEmptyString1000.orThrow(normalized),
            }),
          );

          if (result.ok) {
            setStatus(t("contactSaved"));
            openScannedContactPendingNpubRef.current = normalized;
          } else setStatus(`${t("errorPrefix")}: ${result.error}`);

          closeScan();
          return;
        }
      } catch {
        // ignore
      }

      const maybeLnAddress = normalized.trim();
      const isLnAddress = isLightningAddress(maybeLnAddress);
      if (isLnAddress) {
        if (scanEntryPoint === "receive") {
          setStatus(t("scanReceiveUnsupportedPayment"));
          closeScan();
          return;
        }

        const needle = maybeLnAddress.toLowerCase();
        const existing = contacts.find(
          (contact) =>
            (contact.lnAddress ?? "").trim().toLowerCase() === needle,
        );

        closeScan();
        if (existing?.id) {
          navigateTo({
            route: "contactPay",
            id: ContactId.orThrow(existing.id),
          });
          return;
        }

        // New address: open pay screen and offer to save contact after success.
        navigateTo({ route: "lnAddressPay", lnAddress: maybeLnAddress });
        return;
      }

      // LUD-04 carries tag and challenge in the scanned URL itself, so a login
      // is recognized before the withdraw probe fetches the same target.
      const lnurlAuth = parseLnurlAuthTarget(maybeLnAddress);
      if (lnurlAuth) {
        closeScan();
        requestLnurlAuthConfirmation(lnurlAuth);
        return;
      }

      if (isLnurlWithdrawTarget(maybeLnAddress)) {
        try {
          const withdrawPreview =
            await fetchLnurlWithdrawPreview(maybeLnAddress);
          closeScan();
          requestLnurlWithdrawConfirmation(withdrawPreview);
          return;
        } catch (error) {
          if (!(error instanceof LnurlTagMismatchError)) {
            const message =
              error instanceof Error ? error.message : String(error);
            setStatus(`${t("errorPrefix")}: ${message}`);
            closeScan();
            return;
          }
        }
      }

      if (isLnurlPayTarget(maybeLnAddress)) {
        if (scanEntryPoint === "receive") {
          setStatus(t("scanReceiveUnsupportedPayment"));
          closeScan();
          return;
        }

        const inferredLnAddress =
          inferLightningAddressFromLnurlTarget(maybeLnAddress);
        const existing = inferredLnAddress
          ? contacts.find(
              (contact) =>
                (contact.lnAddress ?? "").trim().toLowerCase() ===
                inferredLnAddress.toLowerCase(),
            )
          : null;

        closeScan();
        if (existing?.id) {
          navigateTo({
            route: "contactPay",
            id: ContactId.orThrow(existing.id),
          });
          return;
        }
        navigateTo({ route: "lnAddressPay", lnAddress: maybeLnAddress });
        return;
      }

      if (/^(lnbc|lntb|lnbcrt)/i.test(normalized)) {
        if (scanEntryPoint === "receive") {
          setStatus(t("scanReceiveUnsupportedPayment"));
          closeScan();
          return;
        }

        const preview = getLightningInvoicePreview(normalized);
        closeScan();

        if (
          preview !== null &&
          preview.amountSat !== null &&
          preview.amountSat <= lightningInvoiceAutoPayLimit
        ) {
          await payLightningInvoiceWithCashu(normalized);
          return;
        }

        requestLightningInvoiceConfirmation(
          preview ?? {
            invoice: normalized,
            amountSat: null,
            description: null,
            expiresAtSec: null,
          },
        );
        return;
      }

      setStatus(`${t("errorPrefix")}: ${t("scanUnsupported")}`);
      closeScan();
    },
    [
      closeScan,
      contacts,
      currentNpub,
      extractCashuTokenFromText,
      contactsRepository,
      lightningInvoiceAutoPayLimit,
      onContactIdentifierScanned,
      payLightningInvoiceWithCashu,
      requestLightningInvoiceConfirmation,
      requestLnurlAuthConfirmation,
      requestLnurlWithdrawConfirmation,
      saveCashuFromText,
      scanAcceptsBankPayment,
      scanEntryPoint,
      setStatus,
      t,
      openScannedContactPendingNpubRef,
      payCashuPaymentRequest,
    ],
  );
};
