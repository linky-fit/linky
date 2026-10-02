import {
  Avatar,
  BrandMark,
  Button,
  Chip,
  Form,
  IconButton,
  LoadingState,
  Notice,
  OptionTile,
  Row,
  SelectField,
  Sheet,
  Stack,
  SubmitButton,
  Text,
  TextField,
} from "@linky-fit/ui";
import React from "react";
import type {
  OnboardingStep,
  PendingOnboardingProfile,
  ReturningOnboardingStep,
} from "../app/hooks/useProfileAuthDomain";
import { type AvatarEditorControlId } from "../derivedProfile";
import type { Lang } from "../i18n";
import { analyzeSlip39Input, SLIP39_WORD_COUNT } from "../utils/slip39Input";
import { AvatarControlGrid } from "./AvatarControlGrid";
import { AvatarPhotoInput } from "./AvatarPhotoInput";
import type { FilePickerHandle } from "../utils/pickFile";
import { StickyTopBar } from "./StickyTopBar";
import { SelfieCaptureModal } from "./SelfieCaptureModal";

import type { Translate } from "../i18n";

interface UnauthenticatedLayoutProps {
  confirmPendingOnboardingProfile: () => Promise<void>;
  createNewAccount: () => Promise<void>;
  cyclePendingOnboardingAvatarControl: (
    controlId: AvatarEditorControlId,
  ) => void;
  lang: Lang;
  onboardingIsBusy: boolean;
  onboardingPhotoInputRef: React.RefObject<FilePickerHandle | null>;
  onboardingStep: OnboardingStep;
  openReturningOnboarding: () => void;
  onPendingOnboardingPhotoError: (error: unknown) => void;
  onPendingOnboardingPhotoSelected: (dataUrl: string) => void;
  pasteReturningSlip39FromClipboard: () => Promise<void>;
  pickPendingOnboardingPhoto: () => Promise<void>;
  savePendingOnboardingBackupToPasswordManager: () => Promise<void>;
  selectPendingOnboardingGeneratedAvatar: () => void;
  selectReturningSlip39Suggestion: (value: string) => void;
  setReturningSlip39Input: (value: string) => void;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  setLang: (lang: Lang) => void;
  setPendingOnboardingName: (value: string) => void;
  submitReturningSlip39: (inputOverride?: string) => Promise<void>;
  t: Translate;
}

const formatTemplate = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? "");

// Keeps the seed field focused (and the phone keyboard open) while tapping helpers.
const keepInputFocus = (event: React.PointerEvent) => event.preventDefault();

const OnboardingLogo = () => (
  <Stack alignItems="center" paddingVertical="$xxl" aria-hidden>
    <BrandMark />
  </Stack>
);

const StepHeading = ({ title, hint }: { title: string; hint?: string }) => (
  <Stack gap="$xs">
    <Text variant="heading" textAlign="center">
      {title}
    </Text>
    {hint ? (
      <Text color="$colorMuted" textAlign="center">
        {hint}
      </Text>
    ) : null}
  </Stack>
);

/** Pins the step's main action to the screen bottom once the step outgrows the screen. */
const StepActions = ({ children }: { children: React.ReactNode }) => (
  <Stack
    position="sticky"
    bottom="$none"
    backgroundColor="$background"
    data-safe-area="bottom"
  >
    <Stack paddingVertical="$xs">{children}</Stack>
  </Stack>
);

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

  const menuButton = (disabled = false) => (
    <IconButton
      icon="Settings"
      size="sm"
      accessibilityLabel={t("menu")}
      onPress={() => setPickerMenuIsOpen((current) => !current)}
      disabled={disabled}
    />
  );
  const backButton = (onPress: () => void) => (
    <IconButton
      icon="ChevronLeft"
      size="sm"
      accessibilityLabel={t("back")}
      onPress={onPress}
      disabled={onboardingIsBusy}
    />
  );

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
  ) =>
    step.error ? (
      <>
        <Notice tone="danger" title={step.error} />
        <Button
          variant="secondary"
          onPress={() => setOnboardingStep(null)}
          disabled={onboardingIsBusy}
        >
          {t("onboardingRetry")}
        </Button>
      </>
    ) : (
      <LoadingState
        label={
          step.step === 1
            ? formatTemplate(t("onboardingStep1"), {
                name: step.derivedName ?? "",
              })
            : t("onboardingStep2")
        }
      />
    );

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
    const helperColor = step.error
      ? "$dangerText"
      : analysis.wordCount > SLIP39_WORD_COUNT ||
          analysis.invalidWords.length > 0
        ? "$warningText"
        : "$colorMuted";

    return (
      <Stack gap="$md">
        <StickyTopBar
          leading={backButton(() => {
            setPickerMenuIsOpen(false);
            setOnboardingStep(null);
          })}
          title={t("onboardingReturn")}
          trailing={menuButton()}
        />

        <Stack gap="$sm">
          <OnboardingLogo />
          <Text color="$colorMuted" textAlign="center">
            {t("onboardingReturnIntro")}
          </Text>
        </Stack>

        <Form onSubmit={() => void submitReturningSlip39()}>
          <TextField
            id="onboarding-return-seed"
            label={t("seed")}
            name="password"
            type="password"
            value={step.input}
            onChangeText={setReturningSlip39Input}
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
            trailing={
              <IconButton
                icon="ClipboardPaste"
                size="sm"
                accessibilityLabel={t("onboardingReturnPasteButton")}
                onPointerDown={keepInputFocus}
                onPress={() => void pasteReturningSlip39FromClipboard()}
                disabled={onboardingIsBusy}
              />
            }
          />

          <Text
            variant="caption"
            color={helperColor}
            role={step.error ? "status" : undefined}
          >
            {helperMessage}
          </Text>

          {analysis.suggestions.length > 0 ? (
            <Row
              flexWrap="wrap"
              gap="$sm"
              aria-label={t("onboardingReturnSuggestions")}
              onPointerDown={keepInputFocus}
            >
              {analysis.suggestions.map((word) => (
                <Chip
                  key={word}
                  label={word}
                  onPress={() => selectReturningSlip39Suggestion(word)}
                  disabled={onboardingIsBusy}
                />
              ))}
            </Row>
          ) : null}

          <StepActions>
            <SubmitButton disabled={onboardingIsBusy || !canSubmit}>
              {t("onboardingReturnConfirm")}
            </SubmitButton>
          </StepActions>
        </Form>
      </Stack>
    );
  };

  const renderProfileNameStep = (profile: PendingOnboardingProfile) => {
    const continueToPicture = () => {
      if (!profile.name.trim()) {
        setNameError(t("onboardingNameRequired"));
        return;
      }
      setNameError(null);
      setProfileStage("picture");
    };

    return (
      <Form onSubmit={continueToPicture}>
        <StepHeading
          title={t("onboardingNameTitle")}
          hint={t("onboardingNameHint")}
        />

        <TextField
          id="onboarding-profile-name"
          label={t("name")}
          hideLabel
          name="profileName"
          value={profile.name}
          onChangeText={(value) => {
            setNameError(null);
            setPendingOnboardingName(value);
          }}
          placeholder={t("namePlaceholder")}
          autoComplete="nickname"
          autoCapitalize="words"
          autoCorrect="off"
          autoFocus
          textAlign="center"
          fontSize="$title"
          error={nameError ?? undefined}
        />

        <StepActions>
          <SubmitButton disabled={onboardingIsBusy}>
            {t("continue")}
          </SubmitButton>
        </StepActions>
      </Form>
    );
  };

  const renderProfilePictureStep = (profile: PendingOnboardingProfile) => {
    const selectedGeneratedAvatar = profile.selectedPictureKind === "generated";

    const submitProfile = async () => {
      await savePendingOnboardingBackupToPasswordManager();

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
      <Form onSubmit={() => void submitProfile()}>
        <StepHeading title={t("onboardingPictureTitle")} />

        <Stack alignItems="center">
          <Avatar
            name={profile.name || t("profileNoName")}
            uri={profile.pictureUrl ?? undefined}
            size="lg"
          />
        </Stack>

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

        <Row gap="$sm" alignItems="stretch">
          <OptionTile
            flex={1}
            icon="ImageUp"
            label={t("profileUploadPhoto")}
            onPress={() => void pickPendingOnboardingPhoto()}
            disabled={onboardingIsBusy}
          />
          <OptionTile
            flex={1}
            icon="Camera"
            label={t("onboardingTakePhoto")}
            onPress={() => setSelfieCaptureIsOpen(true)}
            disabled={onboardingIsBusy}
          />
          <OptionTile
            flex={1}
            icon="Smile"
            label={t("onboardingCreateAvatar")}
            onPress={toggleAvatarEditor}
            disabled={onboardingIsBusy}
            selected={selectedGeneratedAvatar && avatarEditorIsOpen}
          />
        </Row>

        {selectedGeneratedAvatar && avatarEditorIsOpen ? (
          <AvatarControlGrid
            disabled={onboardingIsBusy}
            onCycle={cyclePendingOnboardingAvatarControl}
            t={t}
          />
        ) : null}

        {profile.error ? <Notice tone="danger" title={profile.error} /> : null}

        <StepActions>
          <SubmitButton disabled={onboardingIsBusy}>
            {t("onboardingConfirmProfile")}
          </SubmitButton>
        </StepActions>
      </Form>
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
      <Stack gap="$md">
        <StickyTopBar leading={backButton(goBack)} trailing={menuButton()} />

        {profileStage === "name"
          ? renderProfileNameStep(profile)
          : renderProfilePictureStep(profile)}
      </Stack>
    );
  };

  return (
    <Stack gap="$md">
      {showOnboardingHeader ? (
        <>
          <StickyTopBar trailing={menuButton(onboardingIsBusy)} />

          <OnboardingLogo />
          <Stack gap="$xs" marginBottom="$lg">
            <Text variant="display" textAlign="center">
              {t("onboardingTitle")}
            </Text>
            <Text color="$colorMuted" textAlign="center">
              {t("onboardingSubtitle")}
            </Text>
          </Stack>
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
        <Stack gap="$lg">
          <Stack gap="$sm">
            <Button
              onPress={() => void createNewAccount()}
              disabled={onboardingIsBusy}
            >
              {t("onboardingCreate")}
            </Button>
            <Text variant="caption" color="$colorMuted" textAlign="center">
              {t("onboardingCreateHint")}
            </Text>
          </Stack>

          <Stack gap="$sm">
            <Button
              variant="secondary"
              onPress={() => openReturningOnboarding()}
              disabled={onboardingIsBusy}
            >
              {t("onboardingReturn")}
            </Button>
            <Text variant="caption" color="$colorMuted" textAlign="center">
              {t("onboardingReturnHintShort")}
            </Text>
          </Stack>
        </Stack>
      )}

      <Sheet
        open={pickerMenuIsOpen}
        onOpenChange={setPickerMenuIsOpen}
        title={t("menu")}
      >
        <SelectField
          label={t("language")}
          value={lang}
          options={[
            { value: "cs", label: t("czech") },
            { value: "de", label: t("german") },
            { value: "en", label: t("english") },
            { value: "pt", label: t("portuguese") },
          ]}
          onValueChange={setLang}
        />
      </Sheet>
    </Stack>
  );
};
