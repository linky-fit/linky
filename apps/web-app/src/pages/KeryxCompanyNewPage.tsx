import {
  Button,
  Card,
  Form,
  IconButton,
  ListRow,
  Notice,
  Section,
  Stack,
  SubmitButton,
  Text,
  TextField,
} from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { useKeryxPairing } from "../app/hooks/useKeryxPairing";
import {
  KeryxChannelToggles,
  KeryxCompanyHeader,
  KeryxFooter,
} from "../components/KeryxCompany";
import { readClipboardText } from "../platform/clipboard";

export function KeryxCompanyNewPage(): React.ReactElement {
  const { t } = useAppShellCore();
  const { openScan } = useAdvancedSettingsContext();
  const pairing = useKeryxPairing();
  const [joinUrl, setJoinUrl] = React.useState("");
  const { step, error, busy } = pairing;
  const errorNotice = error ? <Notice tone="danger" title={t(error)} /> : null;

  switch (step.step) {
    case "input":
      return (
        <Form onSubmit={() => void pairing.submit(joinUrl)}>
          <TextField
            label={t("keryxJoinUrlLabel")}
            value={joinUrl}
            onChangeText={setJoinUrl}
            placeholder="https://company.example/join?p=…"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            error={error ? t(error) : undefined}
            trailing={
              <IconButton
                icon="ClipboardPaste"
                size="sm"
                variant="ghost"
                accessibilityLabel={t("paste")}
                onPress={() =>
                  void readClipboardText().then((text) => {
                    if (text) setJoinUrl(text.trim());
                  })
                }
              />
            }
          />
          <SubmitButton disabled={joinUrl.trim() === ""}>
            {t("continue")}
          </SubmitButton>
          <Button variant="secondary" icon="ScanLine" onPress={openScan}>
            {t("keryxScanQr")}
          </Button>
        </Form>
      );

    case "confirm":
      // Only the origin: a name or logo here would be unverified brand chrome.
      return (
        <Stack gap="$lg">
          <Text variant="title">{t("keryxConfirmOriginTitle")}</Text>
          <Card outlined>
            <Text
              variant="title"
              mono
              userSelect="text"
              testID="keryx-confirm-origin"
            >
              {step.request.origin}
            </Text>
          </Card>
          <Text color="$colorMuted">{t("keryxConfirmOriginHint")}</Text>
          {errorNotice}
          <Button loading={busy} onPress={() => void pairing.confirm()}>
            {busy ? t("keryxPairing") : t("continue")}
          </Button>
          <Button variant="secondary" disabled={busy} onPress={pairing.cancel}>
            {t("cancel")}
          </Button>
        </Stack>
      );

    case "consent": {
      const { snapshot, channels } = step;
      const feeds = snapshot.privateFeeds.flatMap((feed) =>
        feed.info === null ? [] : [{ url: feed.url, info: feed.info }],
      );
      return (
        <Stack gap="$lg">
          <KeryxCompanyHeader
            origin={snapshot.origin}
            identity={snapshot.identity}
          />
          <Text color="$colorMuted">{t("keryxConsentHint")}</Text>
          <Section title={t("keryxChannels")}>
            <KeryxChannelToggles
              catalog={snapshot.catalog}
              isFollowed={(name) => channels.has(name)}
              onToggle={pairing.toggleChannel}
            />
          </Section>
          {feeds.length > 0 ? (
            <Section title={t("keryxPrivateFeeds")}>
              {feeds.map(({ url, info }) => (
                <ListRow
                  key={url}
                  icon="Lock"
                  title={info.displayName ?? info.channel}
                  description={t("keryxPrivateFeedAutoSubscribed")}
                />
              ))}
            </Section>
          ) : null}
          {errorNotice}
          <Button loading={busy} onPress={() => void pairing.subscribe()}>
            {t("keryxSubscribe")}
          </Button>
          <Button variant="secondary" disabled={busy} onPress={pairing.cancel}>
            {t("cancel")}
          </Button>
          <KeryxFooter text={t("keryxFooter")} />
        </Stack>
      );
    }
  }
}
