import { Avatar, Button, Card, EmptyState, Stack, Text } from "@linky-fit/ui";
import { useEffect } from "react";
import { SiteLayout, type SiteLayoutCopy } from "../SiteLayout";
import type { SiteLocale } from "../sitePreferences";
import { useSiteLocale } from "../useSiteLocale";
import {
  buildAddContactUrl,
  formatShortNpub,
  readSharedProfile,
} from "./sharedProfile";

interface ProfileCopy extends SiteLayoutCopy {
  openInLinky: string;
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
    addHint:
      "Linky přidá {name} do vašich kontaktů. Linky ještě nemáte? Nejdřív si během chvilky založíte účet.",
    notFound: "Profil nenalezen",
    notFoundDetail: "Zkontrolujte odkaz, který jste dostali.",
  },
  en: {
    ...layoutCopy.en,
    openInLinky: "Open in Linky",
    addHint:
      "Linky adds {name} to your contacts. New to Linky? You'll set up an account in a few seconds first.",
    notFound: "Profile not found",
    notFoundDetail: "Check the link you received.",
  },
  de: {
    ...layoutCopy.de,
    openInLinky: "In Linky öffnen",
    addHint:
      "Linky fügt {name} zu deinen Kontakten hinzu. Neu bei Linky? Du legst vorher in wenigen Sekunden ein Konto an.",
    notFound: "Profil nicht gefunden",
    notFoundDetail: "Prüfe den Link, den du bekommen hast.",
  },
};

const profile = readSharedProfile();

function ProfilePage() {
  const [locale, setLocale] = useSiteLocale();
  const activeCopy = copy[locale];
  const name = profile ? (profile.name ?? formatShortNpub(profile.npub)) : "";

  useEffect(() => {
    document.title = profile ? `${name} · Linky` : activeCopy.notFound;
  }, [activeCopy.notFound, name]);

  return (
    <SiteLayout copy={activeCopy} locale={locale} onLocaleChange={setLocale}>
      <Stack
        width="100%"
        maxWidth="$contentWidth"
        alignSelf="center"
        paddingVertical="$xxl"
      >
        {profile ? (
          <Card
            outlined
            testID="shared-profile"
            alignItems="center"
            gap="$lg"
            padding="$xxl"
            $compact={{ padding: "$lg" }}
          >
            <Avatar name={name} uri={profile.picture ?? undefined} size="lg" />
            <Text
              variant="display"
              color="$colorStrong"
              textAlign="center"
              role="heading"
              aria-level={1}
            >
              {name}
            </Text>
            {profile.about ? (
              <Text color="$colorMuted" textAlign="center">
                {profile.about}
              </Text>
            ) : null}
            <Button
              icon="MessageCircle"
              onPress={() =>
                window.location.assign(buildAddContactUrl(profile.npub))
              }
            >
              {activeCopy.openInLinky}
            </Button>
            <Text variant="caption" color="$colorMuted" textAlign="center">
              {activeCopy.addHint.replace("{name}", name)}
            </Text>
          </Card>
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
