import {
  Avatar,
  BrandHero,
  Button,
  Chip,
  Form,
  IconButton,
  ListRow,
  LoadingState,
  Notice,
  OptionTile,
  Row,
  Sheet,
  Stack,
  SubmitButton,
  Text,
  TextField,
} from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import React from "react";
import type {
  OnboardingStep,
  PendingOnboardingProfile,
  ReturningOnboardingStep,
} from "../app/hooks/useProfileAuthDomain";
import { isLang, type I18nKey, type Lang } from "../i18n";
import { useColorModePreference } from "../hooks/useColorMode";
import {
  COLOR_MODE_PREFERENCE_LABEL_KEYS,
  COLOR_MODE_PREFERENCES,
  setColorModePreference,
  type ColorModePreference,
} from "../utils/colorMode";
import { analyzeSlip39Input, SLIP39_WORD_COUNT } from "../utils/slip39Input";
import { AvatarPhotoInput } from "./AvatarPhotoInput";
import type { FilePickerHandle } from "../utils/pickFile";
import { StickyTopBar } from "./StickyTopBar";
import { SelfieCaptureModal } from "./SelfieCaptureModal";

import type { Translate } from "../i18n";

interface UnauthenticatedLayoutProps {
  confirmPendingOnboardingProfile: () => Promise<void>;
  createNewAccount: () => Promise<void>;
  shufflePendingOnboardingAvatar: () => void;
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
  selectReturningSlip39Suggestion: (value: string) => void;
  setReturningSlip39Input: (value: string) => void;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  setLang: (lang: Lang) => void;
  setPendingOnboardingName: (value: string) => void;
  submitReturningSlip39: (inputOverride?: string) => Promise<void>;
  t: Translate;
}

const LANGUAGE_LABEL_KEYS = {
  cs: "czech",
  de: "german",
  en: "english",
  pt: "portuguese",
} as const satisfies Record<Lang, I18nKey>;

const COLOR_MODE_ICONS = {
  auto: "Monitor",
  light: "Sun",
  dark: "Moon",
} as const satisfies Record<ColorModePreference, IconName>;

const nextColorModePreference = (current: ColorModePreference) =>
  COLOR_MODE_PREFERENCES[
    (COLOR_MODE_PREFERENCES.indexOf(current) + 1) %
      COLOR_MODE_PREFERENCES.length
  ] ?? "auto";

const formatTemplate = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? "");

// Keeps the seed field focused (and the phone keyboard open) while tapping helpers.
const keepInputFocus = (event: React.PointerEvent) => event.preventDefault();

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

/** Centers a step's content in the space above its actions. */
const StepBody = ({ children }: { children: React.ReactNode }) => (
  <Stack
    flexGrow={1}
    justifyContent="center"
    gap="$xl"
    paddingVertical="$xxl"
    width="100%"
    maxWidth="$sheetWidth"
    alignSelf="center"
  >
    {children}
  </Stack>
);

/** Pins the step's main action to the screen bottom. */
const StepActions = ({ children }: { children: React.ReactNode }) => (
  <Stack
    position="sticky"
    bottom="$none"
    backgroundColor="$background"
    data-safe-area="bottom"
  >
    <Stack
      gap="$sm"
      paddingTop="$xs"
      paddingBottom="$lg"
      width="100%"
      maxWidth="$sheetWidth"
      alignSelf="center"
    >
      {children}
    </Stack>
  </Stack>
);

export const UnauthenticatedLayout: React.FC<UnauthenticatedLayoutProps> = ({
  confirmPendingOnboardingProfile,
  createNewAccount,
  shufflePendingOnboardingAvatar,
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
  selectReturningSlip39Suggestion,
  setReturningSlip39Input,
  setOnboardingStep,
  setLang,
  setPendingOnboardingName,
  submitReturningSlip39,
  t,
}) => {
  const [pickerMenuIsOpen, setPickerMenuIsOpen] = React.useState(false);
  const colorModePreference = useColorModePreference();
  const colorModeLabel = `${t("appearance")}: ${t(
    COLOR_MODE_PREFERENCE_LABEL_KEYS[colorModePreference],
  )}`;
  const [profileStage, setProfileStage] = React.useState<"name" | "picture">(
    "name",
  );
  const [nameError, setNameError] = React.useState<string | null>(null);
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
      <Stack flexGrow={1}>
        <StickyTopBar
          leading={backButton(() => {
            setPickerMenuIsOpen(false);
            setOnboardingStep(null);
          })}
          trailing={menuButton()}
        />

        <Form onSubmit={() => void submitReturningSlip39()} flexGrow={1}>
          <StepBody>
            <StepHeading
              title={t("onboardingReturnTitle")}
              hint={t("onboardingReturnIntro")}
            />

            <Stack gap="$sm">
              <TextField
                id="onboarding-return-seed"
                label={t("seed")}
                hideLabel
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
            </Stack>
          </StepBody>

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
      <Form onSubmit={continueToPicture} flexGrow={1}>
        <StepBody>
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
        </StepBody>

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

    const applyPhoto = (dataUrl: string) => {
      setSelfieCaptureIsOpen(false);
      onPendingOnboardingPhotoSelected(dataUrl);
    };

    return (
      <Form onSubmit={() => void submitProfile()} flexGrow={1}>
        <StepBody>
          <StepHeading title={t("onboardingPictureTitle")} />

          <Stack alignItems="center" gap="$sm">
            <Avatar
              name={profile.name || t("profileNoName")}
              uri={profile.pictureUrl ?? undefined}
              size="lg"
            />
            <Text variant="title" textAlign="center">
              {profile.name}
            </Text>
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
              icon="RefreshCcw"
              label={t("shuffleAvatar")}
              onPress={shufflePendingOnboardingAvatar}
              disabled={onboardingIsBusy}
              selected={selectedGeneratedAvatar}
            />
          </Row>

          {profile.error ? (
            <Notice tone="danger" title={profile.error} />
          ) : null}
        </StepBody>

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
      <Stack flexGrow={1}>
        <StickyTopBar leading={backButton(goBack)} trailing={menuButton()} />

        {profileStage === "name"
          ? renderProfileNameStep(profile)
          : renderProfilePictureStep(profile)}
      </Stack>
    );
  };

  const renderWelcome = (
    step: Extract<OnboardingStep, { kind: "preparing" }> | null,
  ) => (
    <Stack flexGrow={1}>
      <StickyTopBar
        trailing={
          <Row gap="$xs" alignItems="center">
            <IconButton
              icon="Languages"
              size="sm"
              accessibilityLabel={t("language")}
              tooltip={t("language")}
              onPress={() => setPickerMenuIsOpen(true)}
              disabled={onboardingIsBusy}
            />
            <IconButton
              icon={COLOR_MODE_ICONS[colorModePreference]}
              size="sm"
              accessibilityLabel={colorModeLabel}
              tooltip={colorModeLabel}
              onPress={() =>
                setColorModePreference(
                  nextColorModePreference(colorModePreference),
                )
              }
            />
          </Row>
        }
      />

      <Stack
        flexGrow={1}
        justifyContent="center"
        alignItems="center"
        gap="$huge"
        paddingVertical="$huge"
      >
        <BrandHero />
        <Stack gap="$xs">
          <Text variant="display" textAlign="center">
            {t("onboardingTitle")}
          </Text>
          <Text color="$colorMuted" textAlign="center">
            {t("onboardingSubtitle")}
          </Text>
        </Stack>
      </Stack>

      <StepActions>
        {step ? (
          renderPreparingStep(step)
        ) : (
          <>
            <Stack gap="$sm" $wide={{ flexDirection: "row" }}>
              <Button
                $wide={{ flex: 1 }}
                onPress={() => void createNewAccount()}
                disabled={onboardingIsBusy}
              >
                {t("onboardingCreate")}
              </Button>
              <Button
                $wide={{ flex: 1 }}
                variant="secondary"
                onPress={() => openReturningOnboarding()}
                disabled={onboardingIsBusy}
              >
                {t("onboardingReturn")}
              </Button>
            </Stack>
            <Text variant="caption" color="$colorMuted" textAlign="center">
              {t("onboardingCreateHint")}
            </Text>
          </>
        )}
      </StepActions>
    </Stack>
  );

  return (
    <Stack gap="$md" flexGrow={1}>
      {onboardingStep?.kind === "profile"
        ? renderProfilePicker(onboardingStep)
        : onboardingStep?.kind === "returning"
          ? renderReturnStep(onboardingStep)
          : renderWelcome(onboardingStep)}

      <Sheet
        open={pickerMenuIsOpen}
        onOpenChange={setPickerMenuIsOpen}
        title={t("language")}
      >
        <Stack>
          {Object.entries(LANGUAGE_LABEL_KEYS).map(([option, labelKey]) => (
            <ListRow
              key={option}
              title={t(labelKey)}
              selected={lang === option}
              chevron={false}
              onPress={() => {
                if (isLang(option)) setLang(option);
                setPickerMenuIsOpen(false);
              }}
            />
          ))}
        </Stack>
      </Sheet>
    </Stack>
  );
};
