import { useAtom, useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { useContactsGuideOverlay } from "../app/hooks/guide/useContactsGuideControls";
import { useEffectiveProfile } from "../app/hooks/profile/useEffectiveProfile";
import { usePaidOverlay, useTranslation } from "../app/hooks/shell";
import { useLoginCommands } from "../app/hooks/shell/login";
import { useCancelNfcWrite } from "../app/hooks/shell/nfc";
import { useScanIsOpen } from "../app/hooks/shell/scan";
import { useShareOptions } from "../app/hooks/shell/share";
import { useWalletCommands } from "../app/hooks/wallet/useWalletCommands";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import { contactNewPrefillAtom } from "../app/state/contacts/contactForm";
import { currentNpubAtom } from "../app/state/session/session";
import {
  lnurlAuthBusyAtom,
  lnurlAuthDoneAtom,
  lnurlWithdrawBusyAtom,
  pendingCashuPaymentRequestAtom,
  pendingLightningInvoiceAtom,
  pendingLnurlAuthAtom,
  pendingLnurlWithdrawAtom,
  pendingPaymentMintMoveAtom,
  pendingSiteLoginAtom,
  postPaySaveContactAtom,
  siteLoginBusyAtom,
  siteLoginDoneAtom,
} from "../app/state/shell/confirmations";
import {
  nfcWritePromptKindAtom,
  profileShareOverlayOpenAtom,
} from "../app/state/shell/overlays";
import { walletOpRunningAtom } from "../app/state/wallet/opQueue";
import { useDesktopSplitView } from "../hooks/useDesktopSplitView";
import { shouldRenderNativeNfcWritePrompt } from "../platform/nativeBridge";
import { EvoluRelayWaitBanner } from "./EvoluRelayWaitBanner";
import { ContactsGuideOverlay } from "./ContactsGuideOverlay";
import { LightningInvoiceConfirmModal } from "./LightningInvoiceConfirmModal";
import { CashuPaymentRequestConfirmModal } from "./CashuPaymentRequestConfirmModal";
import { LnurlAuthModal } from "./LnurlAuthModal";
import { LnurlWithdrawConfirmModal } from "./LnurlWithdrawConfirmModal";
import { NfcWriteModal } from "./NfcWriteModal";
import { SiteLoginModal } from "./SiteLoginModal";
import { PaidOverlay } from "./PaidOverlay";
import { PaymentMintMeltConfirmModal } from "./PaymentMintMeltConfirmModal";
import { ProfileShareOverlay } from "./ProfileShareOverlay";
import { RecurringPaymentDueModal } from "./RecurringPaymentDueModal";
import { SaveContactPromptModal } from "./SaveContactPromptModal";
import { ScanModal } from "./ScanModal";
import { ShareOptionsModal } from "./ShareOptionsModal";
import { Topbar } from "./Topbar";

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
}

export function AuthenticatedLayout({
  children,
}: AuthenticatedLayoutProps): React.ReactElement {
  const isDesktopSplitView = useDesktopSplitView();
  const { t } = useTranslation();
  const guide = useContactsGuideOverlay();
  const scanIsOpen = useScanIsOpen();
  const wallet = useWalletCommands();
  const login = useLoginCommands();
  const { cashuBalanceAfterMelt } = useWalletBalance();
  const cashuIsBusy = useAtomValue(walletOpRunningAtom);
  const paidOverlay = usePaidOverlay();
  const [postPaySaveContact, setPostPaySaveContact] = useAtom(
    postPaySaveContactAtom,
  );
  const setContactNewPrefill = useAtomSet(contactNewPrefillAtom);
  const pendingLightningInvoice = useAtomValue(pendingLightningInvoiceAtom);
  const pendingCashuPaymentRequest = useAtomValue(
    pendingCashuPaymentRequestAtom,
  );
  const pendingPaymentMintMove = useAtomValue(pendingPaymentMintMoveAtom);
  const pendingLnurlWithdraw = useAtomValue(pendingLnurlWithdrawAtom);
  const lnurlWithdrawIsBusy = useAtomValue(lnurlWithdrawBusyAtom);
  const pendingLnurlAuth = useAtomValue(pendingLnurlAuthAtom);
  const lnurlAuthIsBusy = useAtomValue(lnurlAuthBusyAtom);
  const lnurlAuthIsDone = useAtomValue(lnurlAuthDoneAtom);
  const pendingSiteLogin = useAtomValue(pendingSiteLoginAtom);
  const siteLoginIsBusy = useAtomValue(siteLoginBusyAtom);
  const siteLoginIsDone = useAtomValue(siteLoginDoneAtom);
  const nfcWritePromptKind = useAtomValue(nfcWritePromptKindAtom);
  const cancelNfcWrite = useCancelNfcWrite();
  const [profileShareOverlayIsOpen, setProfileShareOverlayIsOpen] = useAtom(
    profileShareOverlayOpenAtom,
  );
  const currentNpub = useAtomValue(currentNpubAtom);
  const { effectiveProfileName, effectiveProfilePicture } =
    useEffectiveProfile();
  const share = useShareOptions();

  // New modals must join dismissTopModal in useAppShellComposition.tsx,
  // or Android back navigates under the open dialog.
  return (
    <>
      {isDesktopSplitView ? null : <Topbar />}
      <EvoluRelayWaitBanner inset={isDesktopSplitView} t={t} />

      {guide.activeStep?.step ? (
        <ContactsGuideOverlay
          currentIdx={guide.activeStep.idx}
          highlightRect={guide.highlightRect}
          onBack={guide.back}
          onNext={guide.next}
          onSkip={guide.stop}
          stepBodyKey={guide.activeStep.step.bodyKey}
          stepTitleKey={guide.activeStep.step.titleKey}
          t={t}
          totalSteps={guide.activeStep.total}
        />
      ) : null}

      {children}

      {!isDesktopSplitView && scanIsOpen ? <ScanModal /> : null}

      {postPaySaveContact && !paidOverlay.paidOverlayIsOpen ? (
        <SaveContactPromptModal
          amountSat={postPaySaveContact.amountSat}
          lnAddress={postPaySaveContact.lnAddress}
          onClose={() => setPostPaySaveContact(null)}
          setContactNewPrefill={setContactNewPrefill}
        />
      ) : null}

      {pendingLightningInvoice &&
      !pendingPaymentMintMove &&
      !paidOverlay.paidOverlayIsOpen ? (
        <LightningInvoiceConfirmModal
          cashuBalance={cashuBalanceAfterMelt}
          cashuIsBusy={cashuIsBusy}
          confirmation={pendingLightningInvoice}
          onClose={wallet.closeLightningInvoiceConfirmation}
          onConfirm={wallet.confirmLightningInvoicePayment}
          t={t}
        />
      ) : null}

      {pendingCashuPaymentRequest &&
      !pendingPaymentMintMove &&
      !paidOverlay.paidOverlayIsOpen ? (
        <CashuPaymentRequestConfirmModal
          cashuIsBusy={cashuIsBusy}
          confirmation={pendingCashuPaymentRequest}
          onClose={wallet.closeCashuPaymentRequestConfirmation}
          onConfirm={wallet.confirmCashuPaymentRequest}
          onEnterAmount={wallet.enterCashuPaymentRequestAmount}
          t={t}
        />
      ) : null}

      {pendingLnurlWithdraw && !paidOverlay.paidOverlayIsOpen ? (
        <LnurlWithdrawConfirmModal
          confirmation={pendingLnurlWithdraw}
          isBusy={lnurlWithdrawIsBusy}
          onClose={wallet.closeLnurlWithdrawConfirmation}
          onConfirm={wallet.confirmLnurlWithdraw}
          t={t}
        />
      ) : null}

      {pendingLnurlAuth && !paidOverlay.paidOverlayIsOpen ? (
        <LnurlAuthModal
          confirmation={pendingLnurlAuth}
          onClose={login.closeLnurlAuthConfirmation}
          onConfirm={login.confirmLnurlAuth}
          phase={
            lnurlAuthIsDone ? "done" : lnurlAuthIsBusy ? "busy" : "confirm"
          }
          t={t}
        />
      ) : null}

      {pendingSiteLogin && !paidOverlay.paidOverlayIsOpen ? (
        <SiteLoginModal
          identity={{
            name: effectiveProfileName,
            npub: currentNpub,
            picture: effectiveProfilePicture,
          }}
          login={pendingSiteLogin}
          onClose={login.closeSiteLoginConfirmation}
          onConfirm={login.confirmSiteLogin}
          phase={
            siteLoginIsDone ? "done" : siteLoginIsBusy ? "busy" : "confirm"
          }
          t={t}
        />
      ) : null}

      {pendingPaymentMintMove && !paidOverlay.paidOverlayIsOpen ? (
        <PaymentMintMeltConfirmModal
          fromMint={pendingPaymentMintMove.fromMint}
          isBusy={cashuIsBusy}
          onClose={wallet.closePaymentMintMeltConfirmation}
          onConfirm={wallet.confirmPaymentMintMelt}
          t={t}
          toMint={pendingPaymentMintMove.toMint}
        />
      ) : null}

      {paidOverlay.paidOverlayIsOpen ? (
        <PaidOverlay
          details={paidOverlay.paidOverlayDetails}
          phase={paidOverlay.paidOverlayPhase}
          paidOverlayTitle={paidOverlay.paidOverlayTitle}
          t={t}
        />
      ) : null}

      {nfcWritePromptKind && shouldRenderNativeNfcWritePrompt() ? (
        <NfcWriteModal
          kind={nfcWritePromptKind}
          onCancel={cancelNfcWrite}
          t={t}
        />
      ) : null}

      {profileShareOverlayIsOpen && currentNpub ? (
        <ProfileShareOverlay
          name={effectiveProfileName}
          npub={currentNpub}
          onClose={() => setProfileShareOverlayIsOpen(false)}
          pictureUrl={effectiveProfilePicture}
          t={t}
        />
      ) : null}

      {share.shareOptionsText ? (
        <ShareOptionsModal
          onClose={share.closeShareOptions}
          onCopy={share.copyShareOptionsText}
          onEmail={share.shareOptionsViaEmail}
          onSms={share.shareOptionsViaSms}
          onWhatsApp={share.shareOptionsViaWhatsApp}
          shareText={share.shareOptionsText}
          t={t}
        />
      ) : null}

      {!paidOverlay.paidOverlayIsOpen ? <RecurringPaymentDueModal /> : null}
    </>
  );
}
