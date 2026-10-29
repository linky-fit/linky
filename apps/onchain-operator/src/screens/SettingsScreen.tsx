import {
  deriveDepositAddress,
  parseDepositXpub,
} from "@linky-fit/onchain-transfer";
import {
  Avatar,
  Button,
  DataValue,
  Dialog,
  ListRow,
  LoadingState,
  Notice,
  Section,
  Stack,
  Switch,
  Text,
  TextField,
} from "@linky-fit/ui";
import { Result } from "effect";
import { useState } from "react";
import { copy } from "../copy/en";
import {
  parseProfileForm,
  profileForm,
  type OperatorProfile,
  type ProfileForm,
  type ProfileFormErrors,
} from "../domain/profile";
import { useAppServices, useDevice, useProfile } from "../services/react";
import { Page } from "./Page";
import { ProfilePictureDialog } from "./ProfilePictureDialog";

type SaveState = "idle" | "saving" | "saved" | "notPublished" | "failed";

export function SettingsScreen() {
  const { account, config } = useAppServices();
  const profile = useProfile();
  const [signingOut, setSigningOut] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [editingPicture, setEditingPicture] = useState(false);
  const device = useDevice();
  return (
    <Page title={copy.sections.settings} testID="settings-screen">
      <Section title={copy.settings.account}>
        <Stack gap="$xs">
          <Text variant="caption" color="$colorMuted">
            {copy.settings.npub}
          </Text>
          <DataValue value={account.npub} previewLength={70} />
        </Stack>
        <ListRow title={copy.settings.network} value={config.network} />
        <ListRow title={copy.settings.mint} value={config.mintUrl} />
        <ListRow title={copy.settings.explorer} value={config.explorerUrl} />
      </Section>
      <Section title={copy.settings.profile}>
        {profile === undefined ? (
          <LoadingState label={copy.loading} />
        ) : (
          <>
            {profile === null ? null : (
              <ListRow
                testID="settings-picture"
                leading={
                  <Avatar
                    name={profile.name}
                    uri={profile.picture ?? undefined}
                    size="sm"
                  />
                }
                title={copy.picture.title}
                onPress={() => setEditingPicture(true)}
              />
            )}
            <ProfileEditor
              // A new picture leaves unsaved form edits alone.
              key={JSON.stringify({ ...profile, picture: null })}
              profile={profile}
              state={saveState}
              onStateChange={setSaveState}
            />
          </>
        )}
      </Section>
      {editingPicture && profile ? (
        <ProfilePictureDialog
          profile={profile}
          onClose={() => setEditingPicture(false)}
        />
      ) : null}
      <Button
        variant="secondary"
        icon="LogOut"
        onPress={() => setSigningOut(true)}
      >
        {copy.settings.signOut}
      </Button>
      <Dialog
        open={signingOut}
        onOpenChange={setSigningOut}
        title={copy.settings.signOutTitle}
        description={copy.settings.signOutDescription}
        actions={
          <>
            <Button variant="danger" onPress={device.resetDevice}>
              {copy.settings.signOut}
            </Button>
            <Button variant="secondary" onPress={() => setSigningOut(false)}>
              {copy.back}
            </Button>
          </>
        }
      />
    </Page>
  );
}

function ProfileEditor({
  profile,
  state,
  onStateChange: setState,
}: {
  readonly profile: OperatorProfile | null;
  readonly state: SaveState;
  readonly onStateChange: (state: SaveState) => void;
}) {
  const { config, profile: profiles } = useAppServices();
  const [form, setForm] = useState<ProfileForm>(() => profileForm(profile));
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const xpubPrefix = config.network === "mainnet" ? "xpub" : "tpub";
  const savedXpub =
    profile === null ? null : parseDepositXpub(profile.xpub, config.network);
  const edit = (change: Partial<ProfileForm>) => {
    setForm((current) => ({ ...current, ...change }));
    setState("idle");
  };

  const save = async () => {
    const parsed = parseProfileForm(form, config.network);
    if (Result.isFailure(parsed)) {
      setErrors(parsed.failure);
      return;
    }
    setErrors({});
    setState("saving");
    try {
      setState(
        (await profiles.save(parsed.success)) ? "saved" : "notPublished",
      );
    } catch (error) {
      console.warn("[onchain-operator] profile not saved", error);
      setState("failed");
    }
  };

  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{copy.settings.profileHint}</Text>
      <TextField
        label={copy.settings.name}
        hint={copy.settings.nameHint}
        value={form.name}
        maxLength={100}
        onChangeText={(name) => edit({ name })}
        error={
          errors.name === undefined ? undefined : copy.settings.nameInvalid
        }
      />
      <TextField
        label={copy.settings.xpub}
        hint={copy.settings.xpubHint(xpubPrefix)}
        value={form.xpub}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        onChangeText={(xpub) => edit({ xpub })}
        error={
          errors.xpub === undefined
            ? undefined
            : copy.settings.xpubInvalid(xpubPrefix)
        }
      />
      <TextField
        label={copy.settings.feePercent}
        value={form.feePercent}
        inputMode="decimal"
        trailing={copy.settings.feeUnit}
        onChangeText={(feePercent) => edit({ feePercent })}
        error={
          errors.feePercent === undefined ? undefined : copy.settings.feeInvalid
        }
      />
      <TextField
        label={copy.settings.amounts}
        hint={copy.settings.amountsHint}
        value={form.amounts}
        onChangeText={(amounts) => edit({ amounts })}
        error={
          errors.amounts === undefined
            ? undefined
            : copy.settings.amountsInvalid
        }
      />
      <TextField
        label={copy.settings.maxReceiveAmount}
        hint={copy.settings.maxReceiveAmountHint}
        value={form.maxReceiveAmount}
        inputMode="numeric"
        trailing="sat"
        onChangeText={(maxReceiveAmount) => edit({ maxReceiveAmount })}
        error={
          errors.maxReceiveAmount === undefined
            ? undefined
            : copy.settings.maxReceiveAmountInvalid
        }
      />
      <TextField
        label={copy.settings.minReceiveAmount}
        hint={copy.settings.minReceiveAmountHint}
        value={form.minReceiveAmount}
        inputMode="numeric"
        trailing="sat"
        onChangeText={(minReceiveAmount) => edit({ minReceiveAmount })}
        error={
          errors.minReceiveAmount === undefined
            ? undefined
            : copy.settings.minReceiveAmountInvalid
        }
      />
      <TextField
        label={copy.settings.minClientVersion}
        hint={copy.settings.minClientVersionHint}
        value={form.minClientVersion}
        inputMode="decimal"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        onChangeText={(minClientVersion) => edit({ minClientVersion })}
        error={
          errors.minClientVersion === undefined
            ? undefined
            : copy.settings.minClientVersionInvalid
        }
      />
      <TextField
        label={copy.settings.watchers}
        hint={copy.settings.watchersHint}
        value={form.watchers}
        multiline
        onChangeText={(watchers) => edit({ watchers })}
        error={
          errors.watchers === undefined
            ? undefined
            : copy.settings.watchersInvalid
        }
      />
      <TextField
        label={copy.settings.description}
        value={form.description}
        multiline
        onChangeText={(description) => edit({ description })}
        error={
          errors.description === undefined
            ? undefined
            : copy.settings.descriptionInvalid
        }
      />
      <ListRow
        title={copy.settings.paused}
        description={copy.settings.pausedHint}
        chevron={false}
        trailing={
          <Switch
            accessibilityLabel={copy.settings.paused}
            value={form.paused}
            onValueChange={(paused) => edit({ paused })}
          />
        }
      />
      <Button
        icon="Save"
        loading={state === "saving"}
        onPress={() => void save()}
      >
        {copy.settings.save}
      </Button>
      {state === "saved" ? (
        <Notice tone="accent" icon="Check" title={copy.settings.saved} />
      ) : null}
      {state === "notPublished" ? (
        <Notice
          tone="warning"
          icon="TriangleAlert"
          title={copy.settings.savedNotPublished}
        />
      ) : null}
      {state === "failed" ? (
        <Notice
          tone="danger"
          icon="CircleAlert"
          title={copy.settings.saveFailed}
        />
      ) : null}
      {savedXpub === null ? null : (
        <Stack gap="$xs">
          <Text variant="caption" color="$colorMuted">
            {copy.settings.firstAddress}
          </Text>
          <Text mono userSelect="text">
            {deriveDepositAddress({
              xpub: savedXpub,
              index: 0,
              network: config.network,
            })}
          </Text>
          <Text variant="caption" color="$colorMuted">
            {copy.settings.firstAddressHint}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
