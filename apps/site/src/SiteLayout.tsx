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

export interface SiteLayoutCopy {
  czechLabel: string;
  englishLabel: string;
  germanLabel: string;
  switchLabel: string;
  followUsLabel: string;
  privacyLabel: string;
  downloadLabel: string;
  appearanceLabel: string;
  appearanceAuto: string;
  appearanceLight: string;
  appearanceDark: string;
}

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
  copy: SiteLayoutCopy;
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
  copy,
  locale,
  onLocaleChange,
  children,
}: SiteLayoutProps) {
  const mode = useColorMode();
  const colorModePreference = useColorModePreference();
  const { wide } = useMedia();
  const [languageSheetIsOpen, setLanguageSheetIsOpen] = useState(false);
  const colorModeLabel = `${copy.appearanceLabel}: ${
    {
      auto: copy.appearanceAuto,
      light: copy.appearanceLight,
      dark: copy.appearanceDark,
    }[colorModePreference]
  }`;
  const languages: [SiteLocale, string][] = [
    ["cs", copy.czechLabel],
    ["de", copy.germanLabel],
    ["en", copy.englishLabel],
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
                {copy.downloadLabel}
              </Button>
            ) : (
              <IconButton
                {...downloadLink}
                icon="Download"
                size="sm"
                variant="accent"
                accessibilityLabel={copy.downloadLabel}
                tooltip={copy.downloadLabel}
              />
            )}
            <IconButton
              icon="Languages"
              size="sm"
              accessibilityLabel={copy.switchLabel}
              tooltip={copy.switchLabel}
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
          <FooterLink href="/cashu/">Cashu</FooterLink>
          <FooterLink href="/follow-us/">{copy.followUsLabel}</FooterLink>
          <FooterLink href="/privacy.html">{copy.privacyLabel}</FooterLink>
        </Row>
      </Stack>
      <Sheet
        open={languageSheetIsOpen}
        onOpenChange={setLanguageSheetIsOpen}
        title={copy.switchLabel}
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
