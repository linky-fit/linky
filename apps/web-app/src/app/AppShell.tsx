import React from "react";
import "../App.css";
import { AuthenticatedLayout } from "../components/AuthenticatedLayout";
import { CashuContactSendBanner } from "../components/CashuContactSendBanner";
import { InstallPwaBanner } from "../components/InstallPwaBanner";
import { PwaUpdateBanner } from "../components/PwaUpdateBanner";
import { ToastNotifications } from "../components/ToastNotifications";
import { UnauthenticatedLayout } from "../components/UnauthenticatedLayout";
import { usePersistentInspectorLogStartup } from "../devtools/inspector/usePersistentInspectorLogStartup";
import {
  AppShellContextsProvider,
  type AppShellActionsContextValue,
  type AppShellCoreContextValue,
  type AppShellRouteContextValue,
} from "./context/AppShellContexts";
import { useCurrentNsec } from "./hooks/useCurrentNsec";
import { AppRouteContent } from "./routes/AppRouteContent";
import { useAppShellComposition } from "./useAppShellComposition";
import { useUnauthenticatedAppShellComposition } from "./useUnauthenticatedAppShellComposition";

interface AuthenticatedAppShellProps {
  currentNsec: string;
  setCurrentNsec: (currentNsec: string | null) => void;
}

const AuthenticatedAppShell = ({
  currentNsec,
  setCurrentNsec,
}: AuthenticatedAppShellProps) => {
  const {
    advancedSettingsContext,
    appActions,
    appState,
    cancelPendingCashuContactSend,
    dismissToast,
    evoluSettingsContext,
    formatDisplayedAmountText,
    isMainSwipeRoute,
    mainSwipeRouteProps,
    mintSettingsContext,
    moneyRouteProps,
    pageClassNameWithSwipe,
    peopleRouteProps,
    pendingCashuContactSend,
    relaySettingsContext,
    t,
    toasts,
  } = useAppShellComposition({ currentNsec, setCurrentNsec });

  const coreContextValue: AppShellCoreContextValue = appState;

  const actionsContextValue: AppShellActionsContextValue = appActions;

  const routeContextValue = React.useMemo<AppShellRouteContextValue>(
    () => ({
      isMainSwipeRoute,
      mainSwipeRoutes: mainSwipeRouteProps,
      moneyRoutes: moneyRouteProps,
      pageClassNameWithSwipe,
      peopleRoutes: peopleRouteProps,
    }),
    [
      isMainSwipeRoute,
      mainSwipeRouteProps,
      moneyRouteProps,
      pageClassNameWithSwipe,
      peopleRouteProps,
    ],
  );

  return (
    <div className={`${pageClassNameWithSwipe} authenticated-page`}>
      <PwaUpdateBanner t={t} />
      <CashuContactSendBanner
        amountText={
          pendingCashuContactSend
            ? formatDisplayedAmountText(pendingCashuContactSend.amountSat)
            : null
        }
        onCancel={() => {
          void cancelPendingCashuContactSend();
        }}
        t={t}
      />
      <ToastNotifications toasts={toasts} dismissToast={dismissToast} />
      <InstallPwaBanner t={t} />

      <AppShellContextsProvider
        actions={actionsContextValue}
        advancedSettings={advancedSettingsContext}
        core={coreContextValue}
        evoluSettings={evoluSettingsContext}
        mintSettings={mintSettingsContext}
        relaySettings={relaySettingsContext}
        routes={routeContextValue}
      >
        <AuthenticatedLayout>
          <AppRouteContent />
        </AuthenticatedLayout>
      </AppShellContextsProvider>
    </div>
  );
};

const UnauthenticatedAppShell = () => {
  const {
    confirmPendingOnboardingProfile,
    createNewAccount,
    cyclePendingOnboardingAvatarControl,
    dismissToast,
    lang,
    onboardingIsBusy,
    onboardingPhotoInputRef,
    onboardingStep,
    openReturningOnboarding,
    onPendingOnboardingPhotoError,
    onPendingOnboardingPhotoSelected,
    pasteReturningSlip39FromClipboard,
    pickPendingOnboardingPhoto,
    savePendingOnboardingBackupToPasswordManager,
    selectPendingOnboardingGeneratedAvatar,
    selectReturningSlip39Suggestion,
    setLang,
    setOnboardingStep,
    setPendingOnboardingName,
    setReturningSlip39Input,
    submitReturningSlip39,
    t,
    toasts,
  } = useUnauthenticatedAppShellComposition();

  return (
    <div className="page">
      <PwaUpdateBanner t={t} />
      <ToastNotifications toasts={toasts} dismissToast={dismissToast} />
      <InstallPwaBanner t={t} />
      <UnauthenticatedLayout
        confirmPendingOnboardingProfile={confirmPendingOnboardingProfile}
        onboardingStep={onboardingStep}
        onboardingIsBusy={onboardingIsBusy}
        lang={lang}
        onboardingPhotoInputRef={onboardingPhotoInputRef}
        openReturningOnboarding={openReturningOnboarding}
        onPendingOnboardingPhotoError={onPendingOnboardingPhotoError}
        onPendingOnboardingPhotoSelected={onPendingOnboardingPhotoSelected}
        setOnboardingStep={setOnboardingStep}
        createNewAccount={createNewAccount}
        cyclePendingOnboardingAvatarControl={
          cyclePendingOnboardingAvatarControl
        }
        pasteReturningSlip39FromClipboard={pasteReturningSlip39FromClipboard}
        pickPendingOnboardingPhoto={pickPendingOnboardingPhoto}
        selectPendingOnboardingGeneratedAvatar={
          selectPendingOnboardingGeneratedAvatar
        }
        selectReturningSlip39Suggestion={selectReturningSlip39Suggestion}
        savePendingOnboardingBackupToPasswordManager={
          savePendingOnboardingBackupToPasswordManager
        }
        setReturningSlip39Input={setReturningSlip39Input}
        setLang={setLang}
        setPendingOnboardingName={setPendingOnboardingName}
        submitReturningSlip39={submitReturningSlip39}
        t={t}
      />
    </div>
  );
};

interface AppShellProps {
  onCommit?: () => void;
}

const AppShell = ({ onCommit }: AppShellProps) => {
  React.useEffect(() => {
    onCommit?.();
  }, [onCommit]);
  const { currentNsec, isResolved, setCurrentNsec } = useCurrentNsec();
  usePersistentInspectorLogStartup();

  if (!isResolved) return <div className="page" />;
  if (!currentNsec) return <UnauthenticatedAppShell />;

  return (
    <AuthenticatedAppShell
      currentNsec={currentNsec}
      setCurrentNsec={setCurrentNsec}
    />
  );
};

export default AppShell;
