import type { PeopleRoutesProps } from "../AppRouteContent";

type ChatProps = PeopleRoutesProps["chatProps"];
type ContactPayProps = PeopleRoutesProps["contactPayProps"];
type ProfileProps = PeopleRoutesProps["profileProps"];

/**
 * What the people screens still take from the wallet, mint, scan and offer
 * compositions; contacts, messages, drafts and profile come from hooks.
 */
interface BuildPeopleRoutePropsParams {
  canWriteNfc: ProfileProps["canWriteToNfc"];
  getMintIconUrl: ChatProps["getMintIconUrl"];
  markMintIconFailed: ChatProps["markMintIconFailed"];
  onPayPaymentRequest: ChatProps["onPayPaymentRequest"];
  onRespondBankPaymentOffer: PeopleRoutesProps["bankPaymentOfferDetailProps"]["onRespondBankPaymentOffer"];
  onSettleBankPaymentOffer: ChatProps["onSettleBankPaymentOffer"];
  payLightningInvoiceWithCashu: ProfileProps["payLightningInvoiceWithCashu"];
  paySelectedContact: ContactPayProps["paySelectedContact"];
  requestSelectedContact: ContactPayProps["requestSelectedContact"];
  shareText: ProfileProps["shareText"];
  writeCurrentNpubToNfc: ProfileProps["writeCurrentNpubToNfc"];
}

export const buildPeopleRouteProps = ({
  canWriteNfc,
  getMintIconUrl,
  markMintIconFailed,
  onPayPaymentRequest,
  onRespondBankPaymentOffer,
  onSettleBankPaymentOffer,
  payLightningInvoiceWithCashu,
  paySelectedContact,
  requestSelectedContact,
  shareText,
  writeCurrentNpubToNfc,
}: BuildPeopleRoutePropsParams): PeopleRoutesProps => ({
  bankPaymentOfferDetailProps: {
    onRespondBankPaymentOffer,
    onSettleBankPaymentOffer,
  },
  chatProps: {
    getMintIconUrl,
    markMintIconFailed,
    onPayPaymentRequest,
    onSettleBankPaymentOffer,
  },
  contactPayProps: { paySelectedContact, requestSelectedContact },
  profileProps: {
    canWriteToNfc: canWriteNfc,
    payLightningInvoiceWithCashu,
    shareText,
    writeCurrentNpubToNfc,
  },
});
