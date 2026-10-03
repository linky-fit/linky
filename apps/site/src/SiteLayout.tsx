import { BrandMark, Row, SelectField, Stack, Text } from "@linky-fit/ui";
import { themes } from "@linky-fit/ui/tokens";
import type { ReactNode } from "react";
import type { SiteLocale } from "./sitePreferences";
import { useSystemColorMode } from "./useSystemColorMode";

export interface SiteLayoutCopy {
  czechLabel: string;
  englishLabel: string;
  germanLabel: string;
  switchLabel: string;
  followUsLabel: string;
  privacyLabel: string;
}

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
  const mode = useSystemColorMode();
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
          <Stack width="$column">
            <SelectField
              label={copy.switchLabel}
              hideLabel
              value={locale}
              options={[
                { value: "cs", label: copy.czechLabel },
                { value: "de", label: copy.germanLabel },
                { value: "en", label: copy.englishLabel },
              ]}
              onValueChange={onLocaleChange}
            />
          </Stack>
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
    </Stack>
  );
}
