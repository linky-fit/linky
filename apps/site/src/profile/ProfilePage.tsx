import { parseProfileGeneralStatus } from "@linky-fit/proxy-payment";
import {
  Avatar,
  Button,
  EmptyState,
  Icon,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import { useEffect } from "react";
import { SiteLayout, type SiteLayoutCopy } from "../SiteLayout";
import type { SiteLocale } from "../sitePreferences";
import { useSiteLocale } from "../useSiteLocale";
import {
  buildAddContactUrl,
  formatShortNpub,
  readSharedProfile,
  type SharedProfile,
} from "./sharedProfile";

interface ProfileCopy extends SiteLayoutCopy {
  openInLinky: string;
  provides: string;
  addHint: string;
  notFound: string;
  notFoundDetail: string;
}

const layoutCopy: Record<SiteLocale, SiteLayoutCopy> = {
  cs: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Jazyk",
    downloadLabel: "Stáhnout aplikaci",
    appearanceLabel: "Vzhled",
    appearanceAuto: "Automaticky",
    appearanceLight: "Světlý",
    appearanceDark: "Tmavý",
    followUsLabel: "Sledujte nás",
    privacyLabel: "Ochrana soukromí",
  },
  en: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Language",
    downloadLabel: "Download the app",
    appearanceLabel: "Appearance",
    appearanceAuto: "Automatic",
    appearanceLight: "Light",
    appearanceDark: "Dark",
    followUsLabel: "Follow us",
    privacyLabel: "Privacy Policy",
  },
  de: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Sprache",
    downloadLabel: "App herunterladen",
    appearanceLabel: "Darstellung",
    appearanceAuto: "Automatisch",
    appearanceLight: "Hell",
    appearanceDark: "Dunkel",
    followUsLabel: "Folge uns",
    privacyLabel: "Datenschutz",
  },
};

const copy: Record<SiteLocale, ProfileCopy> = {
  cs: {
    ...layoutCopy.cs,
    openInLinky: "Otevřít v Linky",
    provides: "Poskytne",
    addHint:
      "Linky přidá {name} do vašich kontaktů. Linky ještě nemáte? Nejdřív si během chvilky založíte účet.",
    notFound: "Profil nenalezen",
    notFoundDetail: "Zkontrolujte odkaz, který jste dostali.",
  },
  en: {
    ...layoutCopy.en,
    openInLinky: "Open in Linky",
    provides: "Provides",
    addHint:
      "Linky adds {name} to your contacts. New to Linky? You'll set up an account in a few seconds first.",
    notFound: "Profile not found",
    notFoundDetail: "Check the link you received.",
  },
  de: {
    ...layoutCopy.de,
    openInLinky: "In Linky öffnen",
    provides: "Bietet",
    addHint:
      "Linky fügt {name} zu deinen Kontakten hinzu. Neu bei Linky? Du legst vorher in wenigen Sekunden ein Konto an.",
    notFound: "Profil nicht gefunden",
    notFoundDetail: "Prüfe den Link, den du bekommen hast.",
  },
};

const profile = readSharedProfile();
const status = parseProfileGeneralStatus(profile?.status);

function ProfileView({
  copy,
  profile,
}: {
  copy: ProfileCopy;
  profile: SharedProfile;
}) {
  const name = profile.name ?? formatShortNpub(profile.npub);
  return (
    <Stack testID="shared-profile" alignItems="center" gap="$xxl">
      <Stack alignItems="center" gap="$md">
        <Avatar name={name} uri={profile.picture ?? undefined} size="lg" />
        <Stack alignItems="center" gap="$xs">
          <Text
            variant="display"
            color="$colorStrong"
            textAlign="center"
            role="heading"
            aria-level={1}
          >
            {name}
          </Text>
          {profile.lightningAddress ? (
            <Row gap="$xs">
              <Icon name="Zap" size="sm" color="$colorMuted" />
              <Text variant="label" color="$colorMuted">
                {profile.lightningAddress}
              </Text>
            </Row>
          ) : null}
        </Stack>
        {status.text ? (
          <Text variant="title" color="$color" textAlign="center">
            {status.text}
          </Text>
        ) : null}
        {status.currencies.length > 0 ? (
          <Row gap="$sm" flexWrap="wrap" justifyContent="center">
            <Text variant="label" color="$colorMuted">
              {copy.provides}
            </Text>
            {status.currencies.map((currency) => (
              <Pill key={currency} label={currency} tone="accent" size="sm" />
            ))}
          </Row>
        ) : null}
      </Stack>
      {profile.about ? (
        <Text color="$colorMuted" textAlign="center">
          {profile.about}
        </Text>
      ) : null}
      <Stack alignSelf="stretch" alignItems="center" gap="$sm">
        <Button
          icon="MessageCircle"
          alignSelf="stretch"
          onPress={() =>
            window.location.assign(buildAddContactUrl(profile.npub))
          }
        >
          {copy.openInLinky}
        </Button>
        <Text variant="caption" color="$colorMuted" textAlign="center">
          {copy.addHint.replace("{name}", name)}
        </Text>
      </Stack>
    </Stack>
  );
}

function ProfilePage() {
  const [locale, setLocale] = useSiteLocale();
  const activeCopy = copy[locale];

  useEffect(() => {
    document.title = profile
      ? `${profile.name ?? formatShortNpub(profile.npub)} · Linky`
      : activeCopy.notFound;
  }, [activeCopy.notFound]);

  return (
    <SiteLayout copy={activeCopy} locale={locale} onLocaleChange={setLocale}>
      <Stack
        width="100%"
        maxWidth="$sheetWidth"
        alignSelf="center"
        paddingVertical="$huge"
      >
        {profile ? (
          <ProfileView copy={activeCopy} profile={profile} />
        ) : (
          <EmptyState
            icon="UserRound"
            title={activeCopy.notFound}
            description={activeCopy.notFoundDetail}
          />
        )}
      </Stack>
    </SiteLayout>
  );
}

export default ProfilePage;
