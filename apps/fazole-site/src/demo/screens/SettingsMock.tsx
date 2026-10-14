import {
  Button,
  Card,
  ListRow,
  Notice,
  Section,
  Stack,
  Switch,
  Text,
} from "@linky-fit/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { copy } from "../../copy";
import { DemoScreen, DemoSheet, Page } from "../chrome";
import { demoAccount } from "../qr";
import { useDemo } from "../store";

const t = copy.demo;

/** Made-up words in the shape of the app's 20-word recovery seed, never a real one. */
const demoSeed =
  "academic acid fortune ceramic deliver lunar marvel plunge hobo task spew cylinder teaspoon garlic dragon emerald width ruler senior evil";

const MASK = "•••••";

function RecoverySeed() {
  const [visible, setVisible] = useState(false);
  const words = demoSeed.split(" ");
  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{t.recoverySeed.description}</Text>
      <Card backgroundColor="$neutralSoft" gap="$xs">
        <Text mono color="$colorStrong">
          {visible ? demoSeed : words.map(() => MASK).join(" ")}
        </Text>
        {visible ? (
          <Text variant="caption" color="$colorMuted">
            {t.recoverySeed.demoNote}
          </Text>
        ) : null}
      </Card>
      <Stack gap="$sm">
        <Button
          variant="secondary"
          icon={visible ? "EyeOff" : "Eye"}
          onPress={() => setVisible((current) => !current)}
        >
          {visible ? t.recoverySeed.hide : t.recoverySeed.show}
        </Button>
        <Button variant="secondary" icon="ShieldCheck" disabled>
          {t.recoverySeed.save}
        </Button>
      </Stack>
      <Notice tone="warning" title={t.recoverySeed.warning} />
    </Stack>
  );
}

/** Settings, like the app's: the shop, the tip switch, the recovery seed and the mint. */
export function SettingsMock({ tabBar }: { tabBar: ReactNode }) {
  const { offerTips, setOfferTips } = useDemo();
  const [showingSeed, setShowingSeed] = useState(false);
  return (
    <DemoScreen
      tabBar={tabBar}
      overlay={
        <DemoSheet
          dialog
          open={showingSeed}
          onClose={() => setShowingSeed(false)}
          title={t.settings.recoverySeed}
        >
          <RecoverySeed />
        </DemoSheet>
      }
    >
      <Page title={t.sections.settings}>
        <Section title={t.settings.shop}>
          <Card paddingVertical="$sm" gap="$none">
            <ListRow
              icon="Store"
              title={t.shopName}
              description={demoAccount.display}
              chevron
            />
            <ListRow
              icon="HandCoins"
              title={t.settings.offerTips}
              description={t.settings.offerTipsDescription}
              chevron={false}
              trailing={
                <Switch
                  accessibilityLabel={t.settings.offerTips}
                  value={offerTips}
                  onValueChange={setOfferTips}
                />
              }
            />
          </Card>
        </Section>
        <Section title={t.settings.security}>
          <Card paddingVertical="$sm" gap="$none">
            <ListRow
              icon="KeyRound"
              title={t.settings.recoverySeed}
              onPress={() => setShowingSeed(true)}
            />
            <ListRow icon="RefreshCcw" title={t.settings.restore} chevron />
            <ListRow
              icon="Trash2"
              title={t.settings.reset}
              destructive
              chevron
            />
          </Card>
        </Section>
        <Section title={t.settings.about}>
          <Card paddingVertical="$sm" gap="$none">
            <ListRow icon="Bitcoin" title={t.settings.mint} value="cashu.cz" />
          </Card>
        </Section>
      </Page>
    </DemoScreen>
  );
}
