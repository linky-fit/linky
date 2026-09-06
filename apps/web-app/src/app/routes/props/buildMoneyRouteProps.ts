import type { Translate } from "../../../i18n";
import type { Route } from "../../../types/route";
import type { MoneyRoutesProps } from "../AppRouteContent";

type MoneyRouteProps = MoneyRoutesProps;

interface BuildMoneyRoutePropsParams {
  canRestoreTokens: boolean;
  canSendCashuTokenToContact: boolean;
  canWriteNfc: boolean;
  canPayWithCashu: MoneyRoutesProps["lnAddressPayProps"]["canPayWithCashu"];
  bankPaymentOfferContacts: MoneyRoutesProps["spdPaymentProps"]["offerContacts"];
  bankPaymentOfferRecipientCount: MoneyRoutesProps["spdPaymentProps"]["initialOfferContactCount"];
  bankPaymentOfferStaggerDelaySec: MoneyRoutesProps["spdPaymentProps"]["initialOfferDelaySec"];
  cashuBalance: MoneyRoutesProps["lnAddressPayProps"]["cashuBalance"];
  cashuBalanceAfterMelt: MoneyRoutesProps["lnAddressPayProps"]["cashuBalanceAfterMelt"];
  cashuTotalBalance: MoneyRoutesProps["cashuTokensProps"]["cashuTotalBalance"];
  cashuBulkCheckIsBusy: MoneyRoutesProps["cashuTokensProps"]["cashuBulkCheckIsBusy"];
  cashuDraft: MoneyRoutesProps["cashuTokenNewProps"]["cashuDraft"];
  cashuDraftRef: MoneyRoutesProps["cashuTokenNewProps"]["cashuDraftRef"];
  cashuEmitAmount: MoneyRoutesProps["cashuTokenEmitProps"]["cashuEmitAmount"];
  cashuHasMultipleAcceptedMints: MoneyRoutesProps["cashuTokenEmitProps"]["cashuHasMultipleAcceptedMints"];
  cashuIsBusy: MoneyRoutesProps["cashuTokensProps"]["cashuIsBusy"];
  cashuIssuedTokens: MoneyRoutesProps["cashuTokensProps"]["cashuIssuedTokens"];
  cashuMeltToMainMintButtonLabel: MoneyRoutesProps["cashuTokensProps"]["cashuMeltToMainMintButtonLabel"];
  cashuTokensAll: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["cashuTokensAll"];
  cashuOwnTokens: MoneyRoutesProps["cashuTokensProps"]["cashuOwnTokens"];
  cashuOwnSpentTokensCount: MoneyRoutesProps["cashuTokensProps"]["cashuOwnSpentTokensCount"];
  deleteSpentCashuTokens: MoneyRoutesProps["cashuTokensProps"]["deleteSpentCashuTokens"];
  deleteSpentCashuTokensIsBusy: MoneyRoutesProps["cashuTokensProps"]["deleteSpentCashuTokensIsBusy"];
  checkAllCashuTokensAndDeleteInvalid: MoneyRoutesProps["cashuTokensProps"]["checkAllCashuTokensAndDeleteInvalid"];
  checkAndRefreshCashuToken: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["checkAndRefreshCashuToken"];
  checkIssuedCashuTokensAndDeleteClaimed: MoneyRoutesProps["cashuTokensProps"]["checkIssuedCashuTokensAndDeleteClaimed"];
  checkSingleIssuedCashuTokenIsClaimed: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["checkSingleIssuedCashuTokenIsClaimed"];
  showPaidOverlay: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["showPaidOverlay"];
  copyText: ReturnType<MoneyRoutesProps["cashuTokenProps"]>["copyText"];
  currentNpub: MoneyRoutesProps["topupProps"]["currentNpub"];
  displayUnit: MoneyRoutesProps["lnAddressPayProps"]["displayUnit"];
  emitCashuToken: MoneyRoutesProps["cashuTokenEmitProps"]["emitCashuToken"];
  getMintIconUrl: MoneyRoutesProps["cashuTokensProps"]["getMintIconUrl"];
  knownLnAddressPayContact: MoneyRoutesProps["lnAddressPayProps"]["knownContact"];
  knownLnAddressPayContactPictureUrl: MoneyRoutesProps["lnAddressPayProps"]["knownContactPictureUrl"];
  lnAddressPayAmount: MoneyRoutesProps["lnAddressPayProps"]["lnAddressPayAmount"];
  manualPayContacts: MoneyRoutesProps["manualPayProps"]["contacts"];
  manualPayNostrPictureByNpub: MoneyRoutesProps["manualPayProps"]["nostrPictureByNpub"];
  onRequestBankPaymentOffer: MoneyRoutesProps["spdPaymentProps"]["onRequestReimbursement"];
  onSubmitManualPayText: MoneyRoutesProps["manualPayProps"]["onSubmitText"];
  meltLargestForeignMintToMainMint: MoneyRoutesProps["cashuTokensProps"]["meltLargestForeignMintToMainMint"];
  payLightningAddressWithCashu: MoneyRoutesProps["lnAddressPayProps"]["payLightningAddressWithCashu"];
  pendingCashuDeleteId: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["pendingCashuDeleteId"];
  restoreMissingTokens: MoneyRoutesProps["cashuTokensProps"]["restoreMissingTokens"];
  reserveCashuToken: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["reserveCashuToken"];
  requestDeleteCashuToken: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["requestDeleteCashuToken"];
  returnCashuTokenToWallet: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["returnCashuTokenToWallet"];
  startSendCashuTokenToContact: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["startSendCashuTokenToContact"];
  route: Route;
  saveCashuFromText: MoneyRoutesProps["cashuTokenNewProps"]["saveCashuFromText"];
  setCashuEmitAmount: MoneyRoutesProps["cashuTokenEmitProps"]["setCashuEmitAmount"];
  setCashuDraft: MoneyRoutesProps["cashuTokenNewProps"]["setCashuDraft"];
  setLnAddressPayAmount: MoneyRoutesProps["lnAddressPayProps"]["setLnAddressPayAmount"];
  setMintIconUrlByMint: MoneyRoutesProps["cashuTokensProps"]["setMintIconUrlByMint"];
  shareCashuTokenText: MoneyRoutesProps["cashuTokenProps"] extends () => infer Props
    ? Props extends { shareTokenText: infer Fn }
      ? Fn
      : never
    : never;
  setTopupAmount: MoneyRoutesProps["topupProps"]["setTopupAmount"];
  t: Translate;
  topupAmount: MoneyRoutesProps["topupProps"]["topupAmount"];
  topupInvoice: MoneyRoutesProps["topupInvoiceProps"]["topupInvoice"];
  topupInvoiceCashuRequest: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceCashuRequest"];
  topupInvoiceError: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceError"];
  topupInvoiceIsBusy: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceIsBusy"];
  topupMintUrl: MoneyRoutesProps["topupInvoiceProps"]["topupMintUrl"];
  topupInvoiceQr: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceQr"];
  topupInvoiceQrPayload: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceQrPayload"];
  tokensRestoreIsBusy: MoneyRoutesProps["cashuTokensProps"]["tokensRestoreIsBusy"];
  writeCashuTokenToNfc: MoneyRoutesProps["cashuTokenProps"] extends () => infer Props
    ? Props extends { writeToNfc: infer Fn }
      ? Fn
      : never
    : never;
}

export const buildMoneyRouteProps = ({
  canRestoreTokens,
  canSendCashuTokenToContact,
  canWriteNfc,
  canPayWithCashu,
  bankPaymentOfferContacts,
  bankPaymentOfferRecipientCount,
  bankPaymentOfferStaggerDelaySec,
  cashuBalance,
  cashuBalanceAfterMelt,
  cashuTotalBalance,
  cashuBulkCheckIsBusy,
  cashuDraft,
  cashuDraftRef,
  cashuEmitAmount,
  cashuHasMultipleAcceptedMints,
  cashuIsBusy,
  cashuIssuedTokens,
  cashuMeltToMainMintButtonLabel,
  cashuTokensAll,
  cashuOwnTokens,
  cashuOwnSpentTokensCount,
  deleteSpentCashuTokens,
  deleteSpentCashuTokensIsBusy,
  checkAllCashuTokensAndDeleteInvalid,
  checkAndRefreshCashuToken,
  checkIssuedCashuTokensAndDeleteClaimed,
  checkSingleIssuedCashuTokenIsClaimed,
  showPaidOverlay,
  copyText,
  currentNpub,
  displayUnit,
  emitCashuToken,
  getMintIconUrl,
  knownLnAddressPayContact,
  knownLnAddressPayContactPictureUrl,
  lnAddressPayAmount,
  manualPayContacts,
  manualPayNostrPictureByNpub,
  onRequestBankPaymentOffer,
  onSubmitManualPayText,
  meltLargestForeignMintToMainMint,
  payLightningAddressWithCashu,
  pendingCashuDeleteId,
  restoreMissingTokens,
  reserveCashuToken,
  requestDeleteCashuToken,
  returnCashuTokenToWallet,
  startSendCashuTokenToContact,
  route,
  saveCashuFromText,
  setCashuEmitAmount,
  setCashuDraft,
  setLnAddressPayAmount,
  setMintIconUrlByMint,
  shareCashuTokenText,
  setTopupAmount,
  t,
  topupAmount,
  topupInvoice,
  topupInvoiceCashuRequest,
  topupInvoiceError,
  topupInvoiceIsBusy,
  topupMintUrl,
  topupInvoiceQr,
  topupInvoiceQrPayload,
  tokensRestoreIsBusy,
  writeCashuTokenToNfc,
}: BuildMoneyRoutePropsParams): MoneyRouteProps => {
  return {
    cashuTokenEmitProps: {
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuEmitAmount,
      cashuHasMultipleAcceptedMints,
      cashuIsBusy,
      cashuMeltToMainMintButtonLabel,
      displayUnit,
      emitCashuToken,
      meltLargestForeignMintToMainMint,
      setCashuEmitAmount,
    },
    cashuTokenNewProps: {
      cashuDraft,
      setCashuDraft,
      cashuDraftRef,
      cashuIsBusy,
      saveCashuFromText,
      t,
    },
    cashuTokensProps: {
      canRestoreTokens,
      cashuTotalBalance,
      cashuBulkCheckIsBusy,
      cashuIsBusy,
      cashuIssuedTokens,
      cashuMeltToMainMintButtonLabel,
      cashuOwnTokens,
      cashuOwnSpentTokensCount,
      deleteSpentCashuTokens,
      deleteSpentCashuTokensIsBusy,
      checkAllCashuTokensAndDeleteInvalid,
      checkIssuedCashuTokensAndDeleteClaimed,
      getMintIconUrl,
      meltLargestForeignMintToMainMint,
      restoreMissingTokens,
      setMintIconUrlByMint,
      tokensRestoreIsBusy,
    },
    cashuTokenProps: () => {
      if (route.kind !== "cashuToken") {
        throw new Error("invalid route for cashu token");
      }
      return {
        canSendToContact: canSendCashuTokenToContact,
        canWriteToNfc: canWriteNfc,
        cashuTokensAll,
        routeId: route.id,
        cashuIsBusy,
        pendingCashuDeleteId,
        checkAndRefreshCashuToken,
        checkSingleIssuedCashuTokenIsClaimed,
        showPaidOverlay,
        copyText,
        reserveCashuToken,
        requestDeleteCashuToken,
        returnCashuTokenToWallet,
        startSendCashuTokenToContact,
        shareTokenText: shareCashuTokenText,
        writeToNfc: writeCashuTokenToNfc,
      };
    },
    lnAddressPayProps: {
      lnAddress: route.kind === "lnAddressPay" ? route.lnAddress : "",
      cashuBalance,
      cashuBalanceAfterMelt,
      canPayWithCashu,
      cashuIsBusy,
      knownContact: knownLnAddressPayContact,
      knownContactPictureUrl: knownLnAddressPayContactPictureUrl,
      lnAddressPayAmount,
      setLnAddressPayAmount,
      displayUnit,
      payLightningAddressWithCashu,
    },
    manualPayProps: {
      contacts: manualPayContacts,
      nostrPictureByNpub: manualPayNostrPictureByNpub,
      onSubmitText: onSubmitManualPayText,
      t,
    },
    spdPaymentProps: {
      cashuBalanceAfterMelt,
      initialOfferContactCount: bankPaymentOfferRecipientCount,
      initialOfferDelaySec: bankPaymentOfferStaggerDelaySec,
      isEditing: route.kind === "bankPayment" && route.editing === true,
      offerContacts: bankPaymentOfferContacts,
      onRequestReimbursement: onRequestBankPaymentOffer,
      spdPayload: route.kind === "bankPayment" ? route.spdPayload : "",
    },
    topupInvoiceProps: {
      topupAmount,
      topupInvoiceCashuRequest,
      topupInvoiceQr,
      topupInvoiceQrPayload,
      topupInvoice,
      topupInvoiceError,
      topupInvoiceIsBusy,
      topupMintUrl,
      copyText,
      t,
    },
    topupProps: {
      currentNpub,
      topupAmount,
      setTopupAmount,
      topupInvoiceIsBusy,
      displayUnit,
      t,
    },
  };
};
