import {
  BrandMark,
  Button,
  IconButton,
  ListRow,
  Row,
  Sheet,
  Stack,
  Text,
  useMedia,
  type IconName,
} from "@linky-fit/ui";
import { themes } from "@linky-fit/ui/tokens";
import { useState, type ReactNode } from "react";
import {
  colorModePreferences,
  setColorModePreference,
  useColorMode,
  useColorModePreference,
  type ColorModePreference,
} from "./colorMode";
import type { SiteLocale } from "./sitePreferences";

const languageLabels = {
  czechLabel: "Čeština",
  englishLabel: "English",
  germanLabel: "Deutsch",
};

const copy = {
  cs: {
    ...languageLabels,
    switchLabel: "Jazyk",
    blogLabel: "Blog",
    followUsLabel: "Sledujte nás",
    privacyLabel: "Ochrana soukromí",
    downloadLabel: "Stáhnout aplikaci",
    appearanceLabel: "Vzhled",
    appearanceAuto: "Automaticky",
    appearanceLight: "Světlý",
    appearanceDark: "Tmavý",
  },
  en: {
    ...languageLabels,
    switchLabel: "Language",
    blogLabel: "Blog",
    followUsLabel: "Follow us",
    privacyLabel: "Privacy Policy",
    downloadLabel: "Download the app",
    appearanceLabel: "Appearance",
    appearanceAuto: "Automatic",
    appearanceLight: "Light",
    appearanceDark: "Dark",
  },
  de: {
    ...languageLabels,
    switchLabel: "Sprache",
    blogLabel: "Blog",
    followUsLabel: "Folge uns",
    privacyLabel: "Datenschutz",
    downloadLabel: "App herunterladen",
    appearanceLabel: "Darstellung",
    appearanceAuto: "Automatisch",
    appearanceLight: "Hell",
    appearanceDark: "Dunkel",
  },
} satisfies Record<SiteLocale, Record<string, string>>;

const colorModeIcons = {
  auto: "Monitor",
  light: "Sun",
  dark: "Moon",
} as const satisfies Record<ColorModePreference, IconName>;

const nextColorModePreference = (current: ColorModePreference) =>
  colorModePreferences[
    (colorModePreferences.indexOf(current) + 1) % colorModePreferences.length
  ] ?? "auto";

// Pressable renders a button; this keeps the download control a real link.
const downloadLink = { render: <a href="/#download" />, role: "link" } as const;

interface SiteLayoutProps {
  locale: SiteLocale;
  onLocaleChange: (locale: SiteLocale) => void;
  children: ReactNode;
}

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <Text
      render={<a href={href} />}
      variant="label"
      color="$colorMuted"
      hoverStyle={{ color: "$color" }}
    >
      {children}
    </Text>
  );
}

export function SiteLayout({
  locale,
  onLocaleChange,
  children,
}: SiteLayoutProps) {
  const activeCopy = copy[locale];
  const mode = useColorMode();
  const colorModePreference = useColorModePreference();
  const { wide } = useMedia();
  const [languageSheetIsOpen, setLanguageSheetIsOpen] = useState(false);
  const colorModeLabel = `${activeCopy.appearanceLabel}: ${
    {
      auto: activeCopy.appearanceAuto,
      light: activeCopy.appearanceLight,
      dark: activeCopy.appearanceDark,
    }[colorModePreference]
  }`;
  const languages: [SiteLocale, string][] = [
    ["cs", activeCopy.czechLabel],
    ["de", activeCopy.germanLabel],
    ["en", activeCopy.englishLabel],
  ];
  return (
    <Stack flexGrow={1} gap="$none" backgroundColor="$background">
      <header
        className="site-header"
        // Translucent page color, so content scrolls under the blurred header.
        style={{ backgroundColor: `${themes[mode].background}cc` }}
      >
        <Row
          justifyContent="space-between"
          width="100%"
          maxWidth="$appWidth"
          alignSelf="center"
          paddingHorizontal="$xl"
          paddingVertical="$md"
        >
          <Row render={<a href="/" aria-label="Linky home" />} gap="$sm">
            <BrandMark size="iconXl" />
            <Text variant="title">Linky</Text>
          </Row>
          <Row gap="$xs" alignItems="center">
            {wide ? (
              <Button
                {...downloadLink}
                size="sm"
                variant="accent"
                icon="Download"
                marginRight="$sm"
              >
                {activeCopy.downloadLabel}
              </Button>
            ) : (
              <IconButton
                {...downloadLink}
                icon="Download"
                size="sm"
                variant="accent"
                accessibilityLabel={activeCopy.downloadLabel}
                tooltip={activeCopy.downloadLabel}
              />
            )}
            <IconButton
              icon="Languages"
              size="sm"
              accessibilityLabel={activeCopy.switchLabel}
              tooltip={activeCopy.switchLabel}
              onPress={() => setLanguageSheetIsOpen(true)}
            />
            <IconButton
              icon={colorModeIcons[colorModePreference]}
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
        </Row>
      </header>
      <Stack
        flexGrow={1}
        width="100%"
        maxWidth="$appWidth"
        alignSelf="center"
        paddingHorizontal="$xl"
        gap="$none"
      >
        <Stack render="main" flexGrow={1} gap="$none">
          {children}
        </Stack>
        <Row render="footer" gap="$lg" flexWrap="wrap" paddingVertical="$xl">
          <FooterLink href="/blog/">{activeCopy.blogLabel}</FooterLink>
          <FooterLink href="/cashu/">Cashu</FooterLink>
          <FooterLink href="/follow-us/">{activeCopy.followUsLabel}</FooterLink>
          <FooterLink href="/privacy.html">
            {activeCopy.privacyLabel}
          </FooterLink>
        </Row>
      </Stack>
      <Sheet
        open={languageSheetIsOpen}
        onOpenChange={setLanguageSheetIsOpen}
        title={activeCopy.switchLabel}
      >
        <Stack>
          {languages.map(([option, label]) => (
            <ListRow
              key={option}
              title={label}
              selected={locale === option}
              chevron={false}
              onPress={() => {
                onLocaleChange(option);
                setLanguageSheetIsOpen(false);
              }}
            />
          ))}
        </Stack>
      </Sheet>
    </Stack>
  );
}
