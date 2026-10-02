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
  cashuBulkCheckIsBusy: MoneyRoutesProps["cashuTokensProps"]["cashuBulkCheckIsBusy"];
  cashuDraft: MoneyRoutesProps["cashuTokenNewProps"]["cashuDraft"];
  cashuDraftRef: MoneyRoutesProps["cashuTokenNewProps"]["cashuDraftRef"];
  cashuEmitAmount: MoneyRoutesProps["cashuTokenEmitProps"]["cashuEmitAmount"];
  cashuHasMultipleAcceptedMints: MoneyRoutesProps["cashuTokenEmitProps"]["cashuHasMultipleAcceptedMints"];
  cashuIsBusy: MoneyRoutesProps["cashuTokensProps"]["cashuIsBusy"];
  cashuMeltToMainMintButtonLabel: MoneyRoutesProps["cashuProofsProps"]["cashuMeltToMainMintButtonLabel"];
  tokenMessages: MoneyRoutesProps["cashuTokensProps"]["messages"];
  cashuProofs: MoneyRoutesProps["cashuTokensProps"]["cashuProofs"];
  cashuTransfers: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["cashuTransfers"];
  inspectCashuProofStates: MoneyRoutesProps["cashuProofsProps"]["inspectCashuProofStates"];
  checkAllCashuTokensAndDeleteInvalid: MoneyRoutesProps["cashuProofsProps"]["checkAllCashuTokensAndDeleteInvalid"];
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
  knownLnAddressPayContact: MoneyRoutesProps["lnAddressPayProps"]["knownContact"];
  knownLnAddressPayContactPictureUrl: MoneyRoutesProps["lnAddressPayProps"]["knownContactPictureUrl"];
  lnAddressPayAmount: MoneyRoutesProps["lnAddressPayProps"]["lnAddressPayAmount"];
  lnAddressPayNote: MoneyRoutesProps["lnAddressPayProps"]["lnAddressPayNote"];
  manualPayContacts: MoneyRoutesProps["manualPayProps"]["contacts"];
  manualPayNostrPictureByNpub: MoneyRoutesProps["manualPayProps"]["nostrPictureByNpub"];
  onRequestBankPaymentOffer: MoneyRoutesProps["spdPaymentProps"]["onRequestReimbursement"];
  onSubmitManualPayText: MoneyRoutesProps["manualPayProps"]["onSubmitText"];
  meltLargestForeignMintToMainMint: MoneyRoutesProps["cashuProofsProps"]["meltLargestForeignMintToMainMint"];
  payLightningAddressWithCashu: MoneyRoutesProps["lnAddressPayProps"]["payLightningAddressWithCashu"];
  reclaimCashuTransfer: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["reclaimCashuTransfer"];
  restoreMissingTokens: MoneyRoutesProps["cashuProofsProps"]["restoreMissingTokens"];
  reclaimHandedOutTokens: MoneyRoutesProps["cashuProofsProps"]["reclaimHandedOutTokens"];
  restoreAndReclaimAllTokens: MoneyRoutesProps["cashuProofsProps"]["restoreAndReclaimAllTokens"];
  deleteCashuToken: ReturnType<
    MoneyRoutesProps["cashuTokenProps"]
  >["deleteCashuToken"];
  setStatus: ReturnType<MoneyRoutesProps["cashuTokenProps"]>["setStatus"];
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
  setLnAddressPayNote: MoneyRoutesProps["lnAddressPayProps"]["setLnAddressPayNote"];
  shareCashuTokenText: MoneyRoutesProps["cashuTokenProps"] extends () => infer Props
    ? Props extends { shareTokenText: infer Fn }
      ? Fn
      : never
    : never;
  setTopupAmount: MoneyRoutesProps["topupProps"]["setTopupAmount"];
  setTopupNote: MoneyRoutesProps["topupProps"]["setTopupNote"];
  receiveMethod: MoneyRoutesProps["topupInvoiceProps"]["receiveMethod"];
  t: Translate;
  topupAmount: MoneyRoutesProps["topupProps"]["topupAmount"];
  topupNote: MoneyRoutesProps["topupProps"]["topupNote"];
  topupInvoice: MoneyRoutesProps["topupInvoiceProps"]["topupInvoice"];
  topupInvoiceCashuRequest: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceCashuRequest"];
  topupInvoiceError: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceError"];
  topupInvoiceIsBusy: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceIsBusy"];
  topupMintUrl: MoneyRoutesProps["topupInvoiceProps"]["topupMintUrl"];
  topupInvoiceQrPayload: MoneyRoutesProps["topupInvoiceProps"]["topupInvoiceQrPayload"];
  tokensRestoreProgress: MoneyRoutesProps["cashuTokensProps"]["tokensRestoreProgress"];
  tokensRestoreIsBusy: MoneyRoutesProps["cashuProofsProps"]["tokensRestoreIsBusy"];
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
  cashuBulkCheckIsBusy,
  cashuDraft,
  cashuDraftRef,
  cashuEmitAmount,
  cashuHasMultipleAcceptedMints,
  cashuIsBusy,
  cashuMeltToMainMintButtonLabel,
  tokenMessages,
  cashuProofs,
  cashuTransfers,
  inspectCashuProofStates,
  checkAllCashuTokensAndDeleteInvalid,
  checkAndRefreshCashuToken,
  checkIssuedCashuTokensAndDeleteClaimed,
  checkSingleIssuedCashuTokenIsClaimed,
  showPaidOverlay,
  copyText,
  currentNpub,
  displayUnit,
  emitCashuToken,
  knownLnAddressPayContact,
  knownLnAddressPayContactPictureUrl,
  lnAddressPayAmount,
  lnAddressPayNote,
  manualPayContacts,
  manualPayNostrPictureByNpub,
  onRequestBankPaymentOffer,
  onSubmitManualPayText,
  meltLargestForeignMintToMainMint,
  payLightningAddressWithCashu,
  reclaimCashuTransfer,
  restoreMissingTokens,
  reclaimHandedOutTokens,
  restoreAndReclaimAllTokens,
  deleteCashuToken,
  setStatus,
  returnCashuTokenToWallet,
  startSendCashuTokenToContact,
  route,
  saveCashuFromText,
  setCashuEmitAmount,
  setCashuDraft,
  setLnAddressPayAmount,
  setLnAddressPayNote,
  shareCashuTokenText,
  setTopupAmount,
  setTopupNote,
  t,
  topupAmount,
  topupNote,
  topupInvoice,
  topupInvoiceCashuRequest,
  topupInvoiceError,
  topupInvoiceIsBusy,
  topupMintUrl,
  topupInvoiceQrPayload,
  receiveMethod,
  tokensRestoreIsBusy,
  tokensRestoreProgress,
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
      tokensRestoreProgress,
      canRestoreTokens,
      tokensRestoreIsBusy,
      restoreMissingTokens,
      cashuIsBusy,
      cashuBulkCheckIsBusy,
      cashuProofs,
      cashuTransfers,
      contacts: manualPayContacts,
      messages: tokenMessages,
      checkIssuedCashuTokensAndDeleteClaimed,
    },
    cashuProofsProps: {
      canRestoreTokens,
      cashuBulkCheckIsBusy,
      cashuIsBusy,
      cashuMeltToMainMintButtonLabel,
      cashuProofs,
      checkAllCashuTokensAndDeleteInvalid,
      inspectCashuProofStates,
      checkIssuedCashuTokensAndDeleteClaimed,
      meltLargestForeignMintToMainMint,
      restoreMissingTokens,
      reclaimHandedOutTokens,
      restoreAndReclaimAllTokens,
      tokensRestoreIsBusy,
    },
    cashuTokenProps: () => {
      if (route.kind !== "cashuToken") {
        throw new Error("invalid route for cashu token");
      }
      return {
        contacts: manualPayContacts,
        messages: tokenMessages,
        reclaimCashuTransfer,
        canSendToContact: canSendCashuTokenToContact,
        canWriteToNfc: canWriteNfc,
        cashuProofs,
        cashuTransfers,
        routeId: route.id,
        inspectCashuProofStates,
        cashuIsBusy: cashuIsBusy || cashuBulkCheckIsBusy || tokensRestoreIsBusy,
        checkAndRefreshCashuToken,
        checkSingleIssuedCashuTokenIsClaimed,
        showPaidOverlay,
        copyText,
        deleteCashuToken,
        setStatus,
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
      lnAddressPayNote,
      setLnAddressPayAmount,
      setLnAddressPayNote,
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
      isEditing:
        route.kind === "bankPaymentNew" ||
        (route.kind === "bankPayment" && route.editing === true),
      isManualEntry: route.kind === "bankPaymentNew",
      offerContacts: bankPaymentOfferContacts,
      onRequestReimbursement: onRequestBankPaymentOffer,
      spdPayload: route.kind === "bankPayment" ? route.spdPayload : "",
    },
    topupInvoiceProps: {
      receiveMethod,
      topupAmount,
      topupInvoiceCashuRequest,
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
      topupNote,
      setTopupNote,
      topupInvoiceIsBusy,
      displayUnit,
      t,
    },
  };
};
