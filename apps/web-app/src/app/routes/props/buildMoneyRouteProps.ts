import type { MoneyRoutesProps } from "../AppRouteContent";

type CashuTokenProps = MoneyRoutesProps["cashuTokenProps"];
type CashuTokensProps = MoneyRoutesProps["cashuTokensProps"];
type CashuProofsProps = MoneyRoutesProps["cashuProofsProps"];
type LnAddressPayProps = MoneyRoutesProps["lnAddressPayProps"];
type ManualPayProps = MoneyRoutesProps["manualPayProps"];
type ProxyPaymentsProps = MoneyRoutesProps["proxyPaymentsProps"];
type SpdPaymentProps = MoneyRoutesProps["spdPaymentProps"];

/**
 * What the money screens still take from the people, profile and scan
 * compositions; everything wallet-owned comes from the feature hooks.
 */
interface BuildMoneyRoutePropsParams {
  bankPaymentOfferContacts: SpdPaymentProps["offerContacts"];
  bankPaymentOfferRecipientCount: SpdPaymentProps["initialOfferContactCount"];
  bankPaymentOfferStaggerDelaySec: SpdPaymentProps["initialOfferDelaySec"];
  canRestoreTokens: CashuProofsProps["canRestoreTokens"];
  canSendCashuTokenToContact: CashuTokenProps["canSendToContact"];
  canWriteNfc: CashuTokenProps["canWriteToNfc"];
  contacts: CashuTokensProps["contacts"] & ManualPayProps["contacts"];
  effectiveMyLightningAddress: MoneyRoutesProps["topupNoAmountProps"]["lightningAddress"];
  knownLnAddressPayContact: LnAddressPayProps["knownContact"];
  knownLnAddressPayContactPictureUrl: LnAddressPayProps["knownContactPictureUrl"];
  lnAddressPayAmount: LnAddressPayProps["lnAddressPayAmount"];
  lnAddressPayNote: LnAddressPayProps["lnAddressPayNote"];
  nostrPictureByNpub: ManualPayProps["nostrPictureByNpub"];
  onRequestBankPaymentOffer: SpdPaymentProps["onRequestReimbursement"];
  onSubmitManualPayText: ManualPayProps["onSubmitText"];
  openWalletScan: ProxyPaymentsProps["openWalletScan"];
  pasteScanValue: MoneyRoutesProps["topupProps"]["pasteScanValue"];
  payLightningAddressWithCashu: LnAddressPayProps["payLightningAddressWithCashu"];
  profileStatusIsSaving: ProxyPaymentsProps["profileStatusIsSaving"];
  proxyPaymentPayerContacts: ProxyPaymentsProps["proxyPaymentPayerContacts"];
  reclaimHandedOutTokens: CashuProofsProps["reclaimHandedOutTokens"];
  restoreAndReclaimAllTokens: CashuProofsProps["restoreAndReclaimAllTokens"];
  restoreMissingTokens: CashuProofsProps["restoreMissingTokens"];
  saveCashuFromText: MoneyRoutesProps["cashuTokenNewProps"]["saveCashuFromText"];
  selectedProfileStatusCurrencies: ProxyPaymentsProps["selectedProfileStatusCurrencies"];
  setLnAddressPayAmount: LnAddressPayProps["setLnAddressPayAmount"];
  setLnAddressPayNote: LnAddressPayProps["setLnAddressPayNote"];
  shareCashuTokenText: CashuTokenProps["shareTokenText"];
  t: ManualPayProps["t"];
  tokenMessages: CashuTokensProps["messages"];
  toggleProfileStatusCurrency: ProxyPaymentsProps["toggleProfileStatusCurrency"];
  writeCashuTokenToNfc: CashuTokenProps["writeToNfc"];
}

export const buildMoneyRouteProps = ({
  bankPaymentOfferContacts,
  bankPaymentOfferRecipientCount,
  bankPaymentOfferStaggerDelaySec,
  canRestoreTokens,
  canSendCashuTokenToContact,
  canWriteNfc,
  contacts,
  effectiveMyLightningAddress,
  knownLnAddressPayContact,
  knownLnAddressPayContactPictureUrl,
  lnAddressPayAmount,
  lnAddressPayNote,
  nostrPictureByNpub,
  onRequestBankPaymentOffer,
  onSubmitManualPayText,
  openWalletScan,
  pasteScanValue,
  payLightningAddressWithCashu,
  profileStatusIsSaving,
  proxyPaymentPayerContacts,
  reclaimHandedOutTokens,
  restoreAndReclaimAllTokens,
  restoreMissingTokens,
  saveCashuFromText,
  selectedProfileStatusCurrencies,
  setLnAddressPayAmount,
  setLnAddressPayNote,
  shareCashuTokenText,
  t,
  tokenMessages,
  toggleProfileStatusCurrency,
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
    canSendToContact: canSendCashuTokenToContact,
    canWriteToNfc: canWriteNfc,
    contacts,
    messages: tokenMessages,
    shareTokenText: shareCashuTokenText,
    writeToNfc: writeCashuTokenToNfc,
  },
  cashuTokensProps: {
    canRestoreTokens,
    contacts,
    messages: tokenMessages,
    restoreMissingTokens,
  },
  lnAddressPayProps: {
    knownContact: knownLnAddressPayContact,
    knownContactPictureUrl: knownLnAddressPayContactPictureUrl,
    lnAddressPayAmount,
    lnAddressPayNote,
    payLightningAddressWithCashu,
    setLnAddressPayAmount,
    setLnAddressPayNote,
  },
  manualPayProps: {
    contacts,
    nostrPictureByNpub,
    onSubmitText: onSubmitManualPayText,
    t,
  },
  proxyPaymentsProps: {
    openWalletScan,
    profileStatusIsSaving,
    proxyPaymentPayerContacts,
    selectedProfileStatusCurrencies,
    toggleProfileStatusCurrency,
  },
  spdPaymentProps: {
    initialOfferContactCount: bankPaymentOfferRecipientCount,
    initialOfferDelaySec: bankPaymentOfferStaggerDelaySec,
    offerContacts: bankPaymentOfferContacts,
    onRequestReimbursement: onRequestBankPaymentOffer,
  },
  topupNoAmountProps: { lightningAddress: effectiveMyLightningAddress },
  topupProps: { pasteScanValue },
});
