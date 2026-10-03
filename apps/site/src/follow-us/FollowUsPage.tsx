import {
  Button,
  Card,
  Image,
  ListRow,
  opacity,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useEffect, useState, type ReactNode } from "react";
import { copyTextToClipboard } from "../clipboard";
import { SiteLayout, type SiteLayoutCopy } from "../SiteLayout";
import type { SiteLocale } from "../sitePreferences";
import { useSiteLocale } from "../useSiteLocale";

const nostrNpub =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
const nostrUri = `nostr:${nostrNpub}`;

interface FollowUsCopy extends SiteLayoutCopy {
  eyebrow: string;
  title: string;
  starLabel: string;
  copyLabel: string;
  copiedLabel: string;
}

const copy: Record<SiteLocale, FollowUsCopy> = {
  cs: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Jazyk",
    eyebrow: "Zůstaňme v kontaktu",
    title: "Sledujte Linky",
    starLabel: "Dejte nám hvězdičku",
    copyLabel: "Kopírovat",
    copiedLabel: "Zkopírováno",
    followUsLabel: "Sledujte nás",
    privacyLabel: "Ochrana soukromí",
  },
  en: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Language",
    eyebrow: "Stay in touch",
    title: "Follow Linky",
    starLabel: "Give us a star",
    copyLabel: "Copy",
    copiedLabel: "Copied",
    followUsLabel: "Follow us",
    privacyLabel: "Privacy Policy",
  },
  de: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Sprache",
    eyebrow: "Bleib in Kontakt",
    title: "Folge Linky",
    starLabel: "Gib uns einen Stern",
    copyLabel: "Kopieren",
    copiedLabel: "Kopiert",
    followUsLabel: "Folge uns",
    privacyLabel: "Datenschutz",
  },
};

interface SocialLinkProps {
  action?: ReactNode;
  detail: string;
  href: string;
  iconSrc: string;
  title: string;
}

function SocialLink({ action, detail, href, iconSrc, title }: SocialLinkProps) {
  const opensNewTab = href.startsWith("https://");

  return (
    <Row gap="$md">
      <Stack
        flex={1}
        render={
          <a
            href={href}
            target={opensNewTab ? "_blank" : undefined}
            rel={opensNewTab ? "noreferrer" : undefined}
          />
        }
        hoverStyle={{ opacity: opacity.dimmed }}
      >
        <ListRow
          leading={
            <Image src={iconSrc} width="$iconXl" height="$iconXl" aria-hidden />
          }
          title={title}
          description={
            <Text variant="caption" color="$colorMuted" wordWrap="break-word">
              {detail}
            </Text>
          }
          chevron={!action}
        />
      </Stack>
      {action}
    </Row>
  );
}

interface CopyButtonProps {
  copiedLabel: string;
  copyLabel: string;
  value: string;
}

function CopyButton({ copiedLabel, copyLabel, value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <Button
      variant="secondary"
      size="sm"
      onPress={() => {
        void copyTextToClipboard(value).then(setCopied);
      }}
    >
      {copied ? copiedLabel : copyLabel}
    </Button>
  );
}

function FollowUsPage() {
  const [locale, setLocale] = useSiteLocale();
  const activeCopy = copy[locale];

  useEffect(() => {
    document.title = activeCopy.title;
  }, [activeCopy.title]);

  return (
    <SiteLayout copy={activeCopy} locale={locale} onLocaleChange={setLocale}>
      <Stack
        width="100%"
        maxWidth="$contentWidth"
        alignSelf="center"
        gap="$xxl"
        paddingVertical="$xxl"
      >
        <Stack gap="$sm">
          <Text eyebrow>{activeCopy.eyebrow}</Text>
          <Text
            variant="display"
            color="$colorStrong"
            role="heading"
            aria-level={1}
          >
            {activeCopy.title}
          </Text>
        </Stack>
        <Card outlined>
          <SocialLink
            href="https://x.com/LinkyFit"
            iconSrc="/x.svg"
            title="X"
            detail="@LinkyFit"
          />
          <SocialLink
            href="https://github.com/linky-fit/linky"
            iconSrc="/github.svg"
            title="GitHub"
            detail={`${activeCopy.starLabel} ★`}
          />
          <SocialLink
            href={nostrUri}
            iconSrc="/nostr.svg"
            title="Nostr"
            detail={nostrNpub}
            action={
              <CopyButton
                copiedLabel={activeCopy.copiedLabel}
                copyLabel={activeCopy.copyLabel}
                value={nostrNpub}
              />
            }
          />
        </Card>
      </Stack>
    </SiteLayout>
  );
}

export default FollowUsPage;
