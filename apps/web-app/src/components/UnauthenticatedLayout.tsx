import {
  Camera,
  ImageUp,
  Languages,
  Copy as PasteIcon,
  Settings,
  Smile,
} from "lucide-react";
import React from "react";
import type {
  OnboardingStep,
  PendingOnboardingProfile,
  ReturningOnboardingStep,
} from "../app/hooks/useProfileAuthDomain";
import { type AvatarEditorControlId } from "../derivedProfile";
import type { Lang } from "../i18n";
import { getInitials } from "../utils/formatting";
import { analyzeSlip39Input, SLIP39_WORD_COUNT } from "../utils/slip39Input";
import { Avatar } from "./Avatar";
import { AvatarControlGrid } from "./AvatarControlGrid";
import { AvatarPhotoInput } from "./AvatarPhotoInput";
import { ModalSheet } from "./ModalSheet";
import {
  PasswordManagerSaveForm,
  type PasswordManagerSaveFormHandle,
} from "./PasswordManagerSaveForm";
import { SelfieCaptureModal } from "./SelfieCaptureModal";

import type { Translate } from "../i18n";
import { sleep } from "../utils/time";

type UnauthenticatedLayoutProps = {
  confirmPendingOnboardingProfile: () => Promise<void>;
  createNewAccount: () => Promise<void>;
  cyclePendingOnboardingAvatarControl: (
    controlId: AvatarEditorControlId,
  ) => void;
  lang: Lang;
  onboardingIsBusy: boolean;
  onboardingPhotoInputRef: React.RefObject<HTMLInputElement | null>;
  onboardingStep: OnboardingStep;
  openReturningOnboarding: () => void;
  onPendingOnboardingPhotoError: (error: unknown) => void;
  onPendingOnboardingPhotoSelected: (dataUrl: string) => void;
  pasteReturningSlip39FromClipboard: () => Promise<void>;
  pickPendingOnboardingPhoto: () => Promise<void>;
  savePendingOnboardingBackupToPasswordManager: (
    username: string,
    password: string,
  ) => Promise<void>;
  selectPendingOnboardingGeneratedAvatar: () => void;
  selectReturningSlip39Suggestion: (value: string) => void;
  setReturningSlip39Input: (value: string) => void;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  setLang: (lang: Lang) => void;
  setPendingOnboardingName: (value: string) => void;
  submitReturningSlip39: (inputOverride?: string) => Promise<void>;
  t: Translate;
};

const formatTemplate = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? "");

export const UnauthenticatedLayout: React.FC<UnauthenticatedLayoutProps> = ({
  confirmPendingOnboardingProfile,
  createNewAccount,
  cyclePendingOnboardingAvatarControl,
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
  setReturningSlip39Input,
  setOnboardingStep,
  setLang,
  setPendingOnboardingName,
  submitReturningSlip39,
  t,
}) => {
  const showOnboardingHeader =
    onboardingStep?.kind !== "profile" && onboardingStep?.kind !== "returning";
  const [pickerMenuIsOpen, setPickerMenuIsOpen] = React.useState(false);
  const [profileStage, setProfileStage] = React.useState<"name" | "picture">(
    "name",
  );
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [avatarEditorIsOpen, setAvatarEditorIsOpen] = React.useState(false);
  const [selfieCaptureIsOpen, setSelfieCaptureIsOpen] = React.useState(false);
  const closeSelfieCapture = React.useCallback(
    () => setSelfieCaptureIsOpen(false),
    [],
  );
  const passwordManagerSaveFormRef =
    React.useRef<PasswordManagerSaveFormHandle | null>(null);

  const renderPickerMenu = () => {
    if (!pickerMenuIsOpen) return null;

    return (
      <ModalSheet
        className="menu-modal-overlay"
        sheetClassName="menu-modal-sheet"
        aria-modal="false"
        aria-label={t("menu")}
        onClick={() => setPickerMenuIsOpen(false)}
      >
        <div className="settings-row">
          <div className="settings-left">
            <span className="settings-icon" aria-hidden="true">
              <Languages size={18} />
            </span>
            <span className="settings-label">{t("language")}</span>
          </div>
          <div className="settings-right">
            <select
              className="select"
              value={lang}
              onChange={(event) =>
                setLang(
                  event.target.value === "cs" || event.target.value === "de"
                    ? event.target.value
                    : "en",
                )
              }
              aria-label={t("language")}
            >
              <option value="cs">{t("czech")}</option>
              <option value="de">{t("german")}</option>
              <option value="en">{t("english")}</option>
            </select>
          </div>
        </div>
      </ModalSheet>
    );
  };

  React.useEffect(() => {
    if (onboardingStep?.kind !== "profile") {
      setProfileStage("name");
      setNameError(null);
      setAvatarEditorIsOpen(false);
      setSelfieCaptureIsOpen(false);
    }
    if (
      onboardingStep?.kind === "profile" ||
      onboardingStep?.kind === "returning"
    ) {
      return;
    }
    setPickerMenuIsOpen(false);
  }, [onboardingStep]);

  const renderPreparingStep = (
    step: Extract<OnboardingStep, { kind: "preparing" }>,
  ) => {
    return (
      <>
        <div className="onboarding-step-heading">
          <p className="muted onboarding-step-hint" role="status">
            {step.step === 1
              ? formatTemplate(t("onboardingStep1"), {
                  name: step.derivedName ?? "",
                })
              : t("onboardingStep2")}
          </p>
        </div>

        {step.error ? (
          <div className="settings-row">
            <div className="status" role="status">
              {step.error}
            </div>
          </div>
        ) : null}

        <div className="settings-row">
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => setOnboardingStep(null)}
            disabled={onboardingIsBusy}
          >
            {t("onboardingRetry")}
          </button>
        </div>
      </>
    );
  };

  const renderReturnStep = (step: ReturningOnboardingStep) => {
    const analysis = analyzeSlip39Input(step.input);
    const canSubmit =
      analysis.wordCount === SLIP39_WORD_COUNT &&
      analysis.invalidWords.length === 0;
    const helperMessage = step.error
      ? step.error
      : analysis.wordCount > SLIP39_WORD_COUNT
        ? t("onboardingReturnTooManyWords")
        : analysis.invalidWords.length > 0
          ? formatTemplate(t("onboardingReturnUnknownWords"), {
              words: analysis.invalidWords.slice(0, 3).join(", "),
            })
          : analysis.hasSeparatorFixups
            ? t("onboardingReturnSeparatorHint")
            : analysis.wordCount > 0
              ? formatTemplate(t("onboardingReturnWordCount"), {
                  count: String(analysis.wordCount),
                  total: String(SLIP39_WORD_COUNT),
                })
              : t("onboardingReturnHint");
    const helperClassName = step.error
      ? "onboarding-return-feedback is-error"
      : analysis.wordCount > SLIP39_WORD_COUNT ||
          analysis.invalidWords.length > 0
        ? "onboarding-return-feedback is-warning"
        : "onboarding-return-feedback";

    return (
      <div className="onboarding-avatar-stage onboarding-return-stage">
        <header className="topbar onboarding-avatar-nav">
          <div className="topbar-left">
            <button
              type="button"
              className="topbar-btn"
              onClick={() => {
                setPickerMenuIsOpen(false);
                setOnboardingStep(null);
              }}
              disabled={onboardingIsBusy}
              aria-label={t("back")}
              title={t("back")}
            >
              <span aria-hidden="true">&lt;</span>
            </button>
          </div>
          <div className="topbar-title" aria-label={t("onboardingReturn")}>
            {t("onboardingReturn")}
          </div>
          <button
            type="button"
            className="topbar-btn"
            onClick={() => setPickerMenuIsOpen((current) => !current)}
            aria-label={t("menu")}
            title={t("menu")}
          >
            <Settings size={20} aria-hidden="true" />
          </button>
        </header>

        {renderPickerMenu()}

        <div className="onboarding-return-scroll">
          <div className="onboarding-return-copy">
            <div
              className="onboarding-logo onboarding-return-logo"
              aria-hidden="true"
            >
              <img
                className="onboarding-logo-svg onboarding-return-logoSvg"
                src="/icon.svg"
                alt=""
                width={256}
                height={256}
                loading="eager"
                decoding="async"
              />
            </div>
            <p className="muted onboarding-avatar-copy onboarding-return-intro">
              {t("onboardingReturnIntro")}
            </p>
          </div>

          <div className="onboarding-return-inputWrap">
            <label
              className="onboarding-avatar-nameLabel"
              htmlFor="onboarding-return-seed"
            >
              {t("seed")}
            </label>
            <div className="onboarding-return-inputRow">
              <input
                id="onboarding-return-seed"
                name="password"
                type="password"
                value={step.input}
                onChange={(event) =>
                  setReturningSlip39Input(event.target.value)
                }
                onPaste={(event) => {
                  const text = event.clipboardData?.getData("text") ?? "";
                  if (!text) return;

                  event.preventDefault();
                  setReturningSlip39Input(text);

                  const pastedAnalysis = analyzeSlip39Input(text);
                  if (pastedAnalysis.isCompleteCandidate) {
                    void submitReturningSlip39(text);
                  }
                }}
                placeholder={t("onboardingReturnPlaceholder")}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="current-password"
                autoFocus
                spellCheck={false}
              />
              <button
                type="button"
                className="onboarding-return-pasteBtn"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void pasteReturningSlip39FromClipboard()}
                disabled={onboardingIsBusy}
                aria-label={t("onboardingReturnPasteButton")}
                title={t("onboardingReturnPasteButton")}
              >
                <PasteIcon className="onboarding-return-pasteIcon" />
              </button>
            </div>
          </div>

          <div
            className={helperClassName}
            role={step.error ? "status" : undefined}
          >
            {helperMessage}
          </div>

          {analysis.suggestions.length > 0 ? (
            <div
              className="onboarding-return-suggestions"
              aria-label={t("onboardingReturnSuggestions")}
            >
              {analysis.suggestions.map((word) => (
                <button
                  key={word}
                  type="button"
                  className="pill pill-muted onboarding-return-suggestion"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => selectReturningSlip39Suggestion(word)}
                  disabled={onboardingIsBusy}
                >
                  {word}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="onboarding-avatar-actions onboarding-avatar-actionsAdaptive">
          <button
            type="button"
            className="btn-wide"
            onClick={() => void submitReturningSlip39()}
            disabled={onboardingIsBusy || !canSubmit}
          >
            {t("onboardingReturnConfirm")}
          </button>
        </div>
      </div>
    );
  };

  const renderProfileNameStep = (profile: PendingOnboardingProfile) => {
    const continueToPicture = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!profile.name.trim()) {
        setNameError(t("onboardingNameRequired"));
        return;
      }
      setNameError(null);
      setProfileStage("picture");
    };

    return (
      <form className="onboarding-avatar-scroll" onSubmit={continueToPicture}>
        <div className="onboarding-step-heading">
          <h2 className="onboarding-step-title">{t("onboardingNameTitle")}</h2>
          <p className="muted onboarding-step-hint">
            {t("onboardingNameHint")}
          </p>
        </div>

        <div className="onboarding-avatar-nameWrap">
          <input
            id="onboarding-profile-name"
            className="onboarding-name-input"
            name="profileName"
            value={profile.name}
            onChange={(event) => {
              setNameError(null);
              setPendingOnboardingName(event.target.value);
            }}
            placeholder={t("namePlaceholder")}
            aria-label={t("name")}
            autoComplete="nickname"
            autoCapitalize="words"
            autoCorrect="off"
            autoFocus
            spellCheck={false}
          />
        </div>

        {nameError ? (
          <div className="settings-row">
            <div className="status" role="status">
              {nameError}
            </div>
          </div>
        ) : null}

        <div className="onboarding-avatar-actions onboarding-avatar-actionsAdaptive">
          <button
            type="submit"
            className="btn-wide"
            disabled={onboardingIsBusy}
          >
            {t("continue")}
          </button>
        </div>
      </form>
    );
  };

  const renderProfilePictureStep = (profile: PendingOnboardingProfile) => {
    const selectedGeneratedAvatar = profile.selectedPictureKind === "generated";

    const submitProfile = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const username = profile.name.trim();
      const password = profile.slip39Seed;

      if (username && password) {
        passwordManagerSaveFormRef.current?.requestSave();
        await savePendingOnboardingBackupToPasswordManager(username, password);

        await sleep(150);
      }

      await confirmPendingOnboardingProfile();
    };

    const toggleAvatarEditor = () => {
      if (selectedGeneratedAvatar && avatarEditorIsOpen) {
        setAvatarEditorIsOpen(false);
        return;
      }
      selectPendingOnboardingGeneratedAvatar();
      setAvatarEditorIsOpen(true);
    };
    const applyPhoto = (dataUrl: string) => {
      setAvatarEditorIsOpen(false);
      setSelfieCaptureIsOpen(false);
      onPendingOnboardingPhotoSelected(dataUrl);
    };

    return (
      <>
        <PasswordManagerSaveForm
          ref={passwordManagerSaveFormRef}
          username={profile.name.trim()}
          password={profile.slip39Seed}
        />

        <form
          className="onboarding-avatar-scroll"
          onSubmit={(event) => void submitProfile(event)}
        >
          <div className="onboarding-step-heading">
            <h2 className="onboarding-step-title">
              {t("onboardingPictureTitle")}
            </h2>
          </div>

          <div className="onboarding-avatar-preview">
            <div
              className="contact-avatar is-xl onboarding-avatar-previewImage"
              aria-hidden="true"
            >
              <Avatar
                pictureUrl={profile.pictureUrl}
                fallback={getInitials(profile.name || t("profileNoName"))}
                fallbackClassName="contact-avatar-fallback"
                loading="eager"
              />
            </div>
          </div>

          <AvatarPhotoInput
            inputRef={onboardingPhotoInputRef}
            onError={onPendingOnboardingPhotoError}
            onSelected={applyPhoto}
            t={t}
          />

          {selfieCaptureIsOpen ? (
            <SelfieCaptureModal
              onCancel={closeSelfieCapture}
              onCaptured={applyPhoto}
              onError={onPendingOnboardingPhotoError}
              t={t}
            />
          ) : null}

          <div className="onboarding-picture-options">
            <button
              type="button"
              className="onboarding-picture-option"
              onClick={() => void pickPendingOnboardingPhoto()}
              disabled={onboardingIsBusy}
            >
              <span
                className="onboarding-picture-optionIcon"
                aria-hidden="true"
              >
                <ImageUp size={22} />
              </span>
              <span className="onboarding-avatar-choiceLabel">
                {t("profileUploadPhoto")}
              </span>
            </button>
            <button
              type="button"
              className="onboarding-picture-option"
              onClick={() => setSelfieCaptureIsOpen(true)}
              disabled={onboardingIsBusy}
            >
              <span
                className="onboarding-picture-optionIcon"
                aria-hidden="true"
              >
                <Camera size={22} />
              </span>
              <span className="onboarding-avatar-choiceLabel">
                {t("onboardingTakePhoto")}
              </span>
            </button>
            <button
              type="button"
              className={`onboarding-picture-option${selectedGeneratedAvatar && avatarEditorIsOpen ? " is-selected" : ""}`}
              onClick={toggleAvatarEditor}
              disabled={onboardingIsBusy}
              aria-pressed={selectedGeneratedAvatar && avatarEditorIsOpen}
            >
              <span
                className="onboarding-picture-optionIcon"
                aria-hidden="true"
              >
                <Smile size={22} />
              </span>
              <span className="onboarding-avatar-choiceLabel">
                {t("onboardingCreateAvatar")}
              </span>
            </button>
          </div>

          {selectedGeneratedAvatar && avatarEditorIsOpen ? (
            <AvatarControlGrid
              disabled={onboardingIsBusy}
              onCycle={cyclePendingOnboardingAvatarControl}
              t={t}
            />
          ) : null}

          {profile.error ? (
            <div className="settings-row">
              <div className="status" role="status">
                {profile.error}
              </div>
            </div>
          ) : null}

          <div className="onboarding-avatar-actions onboarding-avatar-actionsAdaptive">
            <button
              type="submit"
              className="btn-wide"
              disabled={onboardingIsBusy}
            >
              {t("onboardingConfirmProfile")}
            </button>
          </div>
        </form>
      </>
    );
  };

  const renderProfilePicker = (profile: PendingOnboardingProfile) => {
    const goBack = () => {
      setPickerMenuIsOpen(false);
      if (profileStage === "picture") {
        setProfileStage("name");
        return;
      }
      setOnboardingStep(null);
    };

    return (
      <div className="onboarding-avatar-stage">
        <header className="topbar onboarding-avatar-nav">
          <div className="topbar-left">
            <button
              type="button"
              className="topbar-btn"
              onClick={goBack}
              disabled={onboardingIsBusy}
              aria-label={t("back")}
              title={t("back")}
            >
              <span aria-hidden="true">&lt;</span>
            </button>
          </div>
          <span className="topbar-title-spacer" aria-hidden="true" />
          <button
            type="button"
            className="topbar-btn"
            onClick={() => setPickerMenuIsOpen((current) => !current)}
            aria-label={t("menu")}
            title={t("menu")}
          >
            <Settings size={20} aria-hidden="true" />
          </button>
        </header>

        {renderPickerMenu()}

        {profileStage === "name"
          ? renderProfileNameStep(profile)
          : renderProfilePictureStep(profile)}
      </div>
    );
  };

  return (
    <section
      className={`panel panel-plain onboarding-panel${showOnboardingHeader ? "" : " onboarding-panel-compact"}`}
    >
      {showOnboardingHeader ? (
        <>
          <header className="topbar onboarding-avatar-nav">
            <div className="topbar-left">
              <span className="topbar-spacer" aria-hidden="true" />
            </div>
            <span className="topbar-title-spacer" aria-hidden="true" />
            <button
              type="button"
              className="topbar-btn"
              onClick={() => setPickerMenuIsOpen((current) => !current)}
              aria-label={t("menu")}
              title={t("menu")}
              disabled={onboardingIsBusy}
            >
              <Settings size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="onboarding-logo" aria-hidden="true">
            <img
              className="onboarding-logo-svg"
              src="/icon.svg"
              alt=""
              width={256}
              height={256}
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="onboarding-step-heading onboarding-welcome-heading">
            <h1 className="onboarding-step-title onboarding-welcome-title">
              {t("onboardingTitle")}
            </h1>
            <p className="muted onboarding-step-hint">
              {t("onboardingSubtitle")}
            </p>
          </div>

          {renderPickerMenu()}
        </>
      ) : null}

      {onboardingStep ? (
        onboardingStep.kind === "profile" ? (
          renderProfilePicker(onboardingStep)
        ) : onboardingStep.kind === "returning" ? (
          renderReturnStep(onboardingStep)
        ) : (
          renderPreparingStep(onboardingStep)
        )
      ) : (
        <div className="onboarding-welcome-actions">
          <div className="onboarding-welcome-action">
            <button
              type="button"
              className="btn-wide"
              onClick={() => void createNewAccount()}
              disabled={onboardingIsBusy}
            >
              {t("onboardingCreate")}
            </button>
            <span className="muted onboarding-welcome-actionHint">
              {t("onboardingCreateHint")}
            </span>
          </div>

          <div className="onboarding-welcome-action">
            <button
              type="button"
              className="btn-wide secondary"
              onClick={() => openReturningOnboarding()}
              disabled={onboardingIsBusy}
            >
              {t("onboardingReturn")}
            </button>
            <span className="muted onboarding-welcome-actionHint">
              {t("onboardingReturnHintShort")}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
