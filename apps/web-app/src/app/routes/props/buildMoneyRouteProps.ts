import type { MoneyRoutesProps } from "../AppRouteContent";

type CashuTokenProps = MoneyRoutesProps["cashuTokenProps"];
type CashuProofsProps = MoneyRoutesProps["cashuProofsProps"];
type SpdPaymentProps = MoneyRoutesProps["spdPaymentProps"];

/**
 * What the money screens still take from the identity, scan, recovery and
 * proxy offer compositions; everything else comes from the feature hooks.
 */
interface BuildMoneyRoutePropsParams {
  bankPaymentOfferContacts: SpdPaymentProps["offerContacts"];
  bankPaymentOfferRecipientCount: SpdPaymentProps["initialOfferContactCount"];
  bankPaymentOfferStaggerDelaySec: SpdPaymentProps["initialOfferDelaySec"];
  canRestoreTokens: CashuProofsProps["canRestoreTokens"];
  canWriteNfc: CashuTokenProps["canWriteToNfc"];
  onRequestBankPaymentOffer: SpdPaymentProps["onRequestReimbursement"];
  onSubmitManualPayText: MoneyRoutesProps["manualPayProps"]["onSubmitText"];
  openWalletScan: MoneyRoutesProps["proxyPaymentsProps"]["openWalletScan"];
  pasteScanValue: MoneyRoutesProps["topupProps"]["pasteScanValue"];
  payLightningAddressWithCashu: MoneyRoutesProps["lnAddressPayProps"]["payLightningAddressWithCashu"];
  reclaimHandedOutTokens: CashuProofsProps["reclaimHandedOutTokens"];
  restoreAndReclaimAllTokens: CashuProofsProps["restoreAndReclaimAllTokens"];
  restoreMissingTokens: CashuProofsProps["restoreMissingTokens"];
  saveCashuFromText: MoneyRoutesProps["cashuTokenNewProps"]["saveCashuFromText"];
  shareCashuTokenText: CashuTokenProps["shareTokenText"];
  writeCashuTokenToNfc: CashuTokenProps["writeToNfc"];
}

export const buildMoneyRouteProps = ({
  bankPaymentOfferContacts,
  bankPaymentOfferRecipientCount,
  bankPaymentOfferStaggerDelaySec,
  canRestoreTokens,
  canWriteNfc,
  onRequestBankPaymentOffer,
  onSubmitManualPayText,
  openWalletScan,
  pasteScanValue,
  payLightningAddressWithCashu,
  reclaimHandedOutTokens,
  restoreAndReclaimAllTokens,
  restoreMissingTokens,
  saveCashuFromText,
  shareCashuTokenText,
  writeCashuTokenToNfc,
}: BuildMoneyRoutePropsParams): MoneyRoutesProps => ({
  cashuProofsProps: {
    canRestoreTokens,
    reclaimHandedOutTokens,
    restoreAndReclaimAllTokens,
    restoreMissingTokens,
  },
  cashuTokenNewProps: { saveCashuFromText },
  cashuTokenProps: {
    canWriteToNfc: canWriteNfc,
    shareTokenText: shareCashuTokenText,
    writeToNfc: writeCashuTokenToNfc,
  },
  cashuTokensProps: { canRestoreTokens, restoreMissingTokens },
  lnAddressPayProps: { payLightningAddressWithCashu },
  manualPayProps: { onSubmitText: onSubmitManualPayText },
  proxyPaymentsProps: { openWalletScan },
  spdPaymentProps: {
    initialOfferContactCount: bankPaymentOfferRecipientCount,
    initialOfferDelaySec: bankPaymentOfferStaggerDelaySec,
    offerContacts: bankPaymentOfferContacts,
    onRequestReimbursement: onRequestBankPaymentOffer,
  },
  topupProps: { pasteScanValue },
});
