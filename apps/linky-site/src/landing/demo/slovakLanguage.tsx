import {
  Amount,
  Button,
  Icon,
  IconButton,
  ListRow,
  Row,
  Section,
  Stack,
  Switch,
  Text,
  TopBar,
  type IconName,
} from "@linky-fit/ui";
import type { ReactNode } from "react";
import { DemoTabBar, type Tab } from "./chrome";
import { FlowScenes, Tap } from "./flow";
import { noop } from "./noop";
import { useFlow } from "./playback";

type Lang = "en" | "sk";

// The app's own strings from `apps/linky-app/src/i18n/{en,sk}.ts`.
const copy = {
  en: {
    settings: "Settings",
    settingsGeneral: "General",
    language: "Language",
    appearance: "Appearance",
    appearanceAuto: "Automatic",
    unit: "Units",
    notifications: "Notifications",
    sendReadReceipts: "Send read receipts",
    passOnListings: "Pass contacts' listings on",
    blocked: "Blocked",
    showProfileQrOnTilt: "Tilt to show profile",
    settingsAbout: "About Linky",
    tutorial: "Tutorial",
    feedback: "Feedback",
    supportLinky: "Support Linky",
    whatsNew: "What's new",
    wallet: "Wallet",
    walletHistory: "History",
    walletReceive: "Receive",
    walletSend: "Send",
  },
  sk: {
    settings: "Nastavenia",
    settingsGeneral: "Všeobecné",
    language: "Jazyk",
    appearance: "Vzhľad",
    appearanceAuto: "Automaticky",
    unit: "Jednotky",
    notifications: "Notifikácie",
    sendReadReceipts: "Odosielať potvrdenia o prečítaní",
    passOnListings: "Odovzdávať ponuky kontaktov ďalej",
    blocked: "Blokovaní",
    showProfileQrOnTilt: "Naklonením zobraziť profil",
    settingsAbout: "O aplikácii",
    tutorial: "Tutoriál",
    feedback: "Spätná väzba",
    supportLinky: "Podporiť Linky",
    whatsNew: "Čo je nové",
    wallet: "Peňaženka",
    walletHistory: "História",
    walletReceive: "Prijať",
    walletSend: "Odoslať",
  },
} as const satisfies Record<Lang, Record<string, string>>;

// Each language is named in itself, so the list reads the same in every language.
const languages = [
  { value: "cs", name: "Čeština" },
  { value: "de", name: "Deutsch" },
  { value: "en", name: "English" },
  { value: "pt", name: "Português (Brasil)" },
  { value: "sk", name: "Slovenčina" },
] as const;

const appVersion = "26.11.5";

/** The phone top bar: a large heading on the section tabs, a centered title with back below them. */
function Bar({
  title,
  section = false,
  tapBack = false,
}: {
  title: string;
  section?: boolean;
  tapBack?: boolean;
}) {
  const action = (icon: IconName) => (
    <IconButton
      icon={icon}
      size="sm"
      variant="ghost"
      accessibilityLabel={icon}
      onPress={noop}
    />
  );
  return (
    <TopBar
      large={section}
      title={title}
      leading={section ? null : <Tap on={tapBack}>{action("ChevronLeft")}</Tap>}
      trailing={section ? action("ScanLine") : null}
    />
  );
}

/** A page's content inside the app's phone gutter. */
function Page({ children }: { children: ReactNode }) {
  return (
    <Stack
      flex={1}
      paddingHorizontal="$xl"
      paddingTop="$md"
      paddingBottom="$huge"
      overflow="hidden"
    >
      {children}
    </Stack>
  );
}

/** The Settings tab as the app lays it out, in `lang`, with touches on the Language row or a tab. */
function SettingsScene({
  lang,
  tapLanguage = false,
  tapTab,
}: {
  lang: Lang;
  tapLanguage?: boolean;
  tapTab?: Tab | undefined;
}) {
  const t = copy[lang];
  const link = (icon: IconName, title: string, value?: string) => (
    <ListRow icon={icon} title={title} value={value} onPress={noop} />
  );
  const toggle = (icon: IconName, title: string, value: boolean) => (
    <ListRow
      icon={icon}
      title={title}
      trailing={
        <Switch accessibilityLabel={title} value={value} onValueChange={noop} />
      }
    />
  );
  return (
    <>
      <Bar title={t.settings} section />
      <Page>
        <Stack gap="$xl">
          <Section grouped title={t.settingsGeneral}>
            <Tap on={tapLanguage}>{link("Languages", t.language)}</Tap>
            {link("Palette", t.appearance, t.appearanceAuto)}
            {link("Bitcoin", t.unit)}
            {toggle("Bell", t.notifications, true)}
            {toggle("CheckCheck", t.sendReadReceipts, true)}
            {toggle("Share2", t.passOnListings, true)}
            {link("Ban", t.blocked)}
            {toggle("Smartphone", t.showProfileQrOnTilt, false)}
          </Section>
          <Section grouped title={t.settingsAbout}>
            {link("Compass", t.tutorial)}
            {link("MessageCircle", t.feedback)}
            <ListRow
              leading={
                <Icon name="HeartHandshake" size="sm" color="$accentText" />
              }
              title={
                <Text bold color="$accentText">
                  {t.supportLinky}
                </Text>
              }
              onPress={noop}
            />
            {link("Newspaper", t.whatsNew, appVersion)}
          </Section>
        </Stack>
      </Page>
      <DemoTabBar active="settings" tap={tapTab} />
    </>
  );
}

/** Settings > Language in `lang`, with `lang` checked and touches on a language or back. */
function LanguageScene({
  lang,
  tapped,
  tapBack = false,
}: {
  lang: Lang;
  tapped?: Lang | undefined;
  tapBack?: boolean;
}) {
  return (
    <>
      <Bar title={copy[lang].language} tapBack={tapBack} />
      <Page>
        <Section grouped>
          {languages.map(({ value, name }) => (
            <Tap key={value} on={value === tapped}>
              <ListRow
                title={name}
                selected={value === lang}
                chevron={false}
                onPress={noop}
              />
            </Tap>
          ))}
        </Section>
      </Page>
    </>
  );
}

/** The Wallet tab in Slovak, the balance shown in euro as the app formats it for `sk-SK`. */
function SlovakWalletScene() {
  const t = copy.sk;
  return (
    <>
      <Bar title={t.wallet} section />
      <Page>
        <Stack flexGrow={1} gap="$xxl" justifyContent="space-between">
          <Stack alignItems="center" gap="$xs" paddingTop="$xxl">
            <Amount value={"~1 284"} unit="EUR" size="xl" />
            <Button variant="ghost" size="sm" icon="History" onPress={noop}>
              {t.walletHistory}
            </Button>
          </Stack>
          <Row gap="$sm">
            <Button
              flex={1}
              icon="ArrowDownRight"
              minHeight="$controlLg"
              borderRadius="$pill"
              onPress={noop}
            >
              {t.walletReceive}
            </Button>
            <Button
              flex={1}
              icon="ArrowUpRight"
              minHeight="$controlLg"
              borderRadius="$pill"
              onPress={noop}
            >
              {t.walletSend}
            </Button>
          </Row>
        </Stack>
      </Page>
      <DemoTabBar active="wallet" />
    </>
  );
}

// Ms after mount, in time order, as `useFlow` plays them; exported for the video capture.
// eslint-disable-next-line react-refresh/only-export-components
export const slovakLanguageCues = {
  tapLanguage: 900,
  languages: 1200,
  tapSlovak: 2300,
  slovak: 2600,
  tapBack: 3700,
  settings: 4000,
  tapWallet: 5100,
  wallet: 5400,
};

/** Dave switches Linky to Slovak in Settings > Language and finds the whole app, wallet included, in Slovak. */
export function SlovakLanguageScreen() {
  const at = useFlow(slovakLanguageCues);
  const current = [
    at("languages"),
    at("slovak"),
    at("settings"),
    at("wallet"),
  ].filter(Boolean).length;
  return (
    <FlowScenes
      current={current}
      scenes={[
        {
          node: <SettingsScene lang="en" tapLanguage={at("tapLanguage")} />,
        },
        {
          node: (
            <LanguageScene
              lang="en"
              tapped={at("tapSlovak") ? "sk" : undefined}
            />
          ),
          enter: "push",
        },
        { node: <LanguageScene lang="sk" tapBack={at("tapBack")} /> },
        {
          node: (
            <SettingsScene
              lang="sk"
              tapTab={at("tapWallet") ? "wallet" : undefined}
            />
          ),
          enter: "back",
        },
        { node: <SlovakWalletScene /> },
      ]}
    />
  );
}
