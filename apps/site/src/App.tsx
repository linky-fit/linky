import {
  Button,
  Card,
  Icon,
  Image,
  Row,
  SelectField,
  Stack,
  Text,
  useMedia,
} from "@linky-fit/ui";
import { useState } from "react";
import { SiteLayout } from "./SiteLayout";
import type { SiteLocale } from "./sitePreferences";
import { useSiteLocale } from "./useSiteLocale";

type CtaMode = "android-apk" | "google-play" | "web" | "zapstore";

interface UspItemCopy {
  title: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
}

interface LocaleCopy {
  czechLabel: string;
  englishLabel: string;
  germanLabel: string;
  switchLabel: string;
  title: string;
  subtitle: string;
  webCta: string;
  googlePlayCta: string;
  androidApkCta: string;
  zapstoreCta: string;
  ctaMenuLabel: string;
  privacyLabel: string;
  heroImageAlt: string;
  followUsLabel: string;
  uspSectionTitle: string;
  uspItems: [UspItemCopy, UspItemCopy, UspItemCopy];
  closingSectionTitle: string;
  closingSectionDescription: string;
  closingImageAlt: string;
}

const ctaModes: readonly CtaMode[] = [
  "web",
  "google-play",
  "android-apk",
  "zapstore",
];

const ctaUrls: Record<CtaMode, string> = {
  "android-apk":
    "https://github.com/hynek-jina/linky/releases/latest/download/linky.apk",
  "google-play": "https://play.google.com/store/apps/details?id=fit.linky.app",
  web: "https://app.linky.fit",
  zapstore: "https://zapstore.dev/apps/fit.linky.app",
};

const copy: Record<SiteLocale, LocaleCopy> = {
  cs: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Jazyk",
    title: "Budujte svou bitcoinovou síť",
    subtitle:
      "Každou platbou vytváříte a posilujete vztahy s lidmi kolem sebe. S Linky posíláte bitcoin stejně jednoduše jako běžnou zprávu - svým blízkým i komukoliv dalšímu.",
    webCta: "Webová aplikace",
    googlePlayCta: "Google Play",
    androidApkCta: "Android APK",
    zapstoreCta: "Zapstore",
    ctaMenuLabel: "Možnosti otevření aplikace",
    privacyLabel: "Ochrana soukromí",
    heroImageAlt: "Aplikace Linky na telefonu v ruce",
    followUsLabel: "Sledujte nás",
    uspSectionTitle: "Proč Linky",
    uspItems: [
      {
        title: "Posílejte bitcoin stejně jako zprávu",
        description:
          "Vyberete kontakt, zadáte částku a pošlete platbu stejně jakoukoliv zprávu.",
        imageSrc: "/contacts_mock.png",
        imageAlt: "Ukázka posílání bitcoinu kontaktu v aplikaci Linky",
      },
      {
        title: "Vyžádejte si platbu",
        description:
          "Pošlete si žádost o zaplacení přímo v chatu a druhá strana ji může potvrdit jedním klepnutím.",
        imageSrc: "/request_mock.png",
        imageAlt: "Ukázka žádosti o platbu v aplikaci Linky",
      },
      {
        title: "Pošlete bitcoin i lidem bez peněženky",
        description:
          "Platbu můžete připravit i pro někoho, kdo ještě žádnou peněženku nemá. Linky mu ji pomůže jednoduše převzít.",
        imageSrc: "/issue_mock.png",
        imageAlt:
          "Ukázka sdílení bitcoinu lidem bez peněženky v aplikaci Linky",
      },
    ],
    closingSectionTitle: "Soukromí",
    closingSectionDescription:
      "Uživatelé nepotřebují telefonní číslo, e-mail ani žádné doklady.",
    closingImageAlt:
      "Ukázka soukromého používání aplikace Linky bez osobních údajů",
  },
  en: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Language",
    title: "Build your bitcoin network",
    subtitle:
      "Every payment helps you grow and strengthen your network of people. With Linky, you send bitcoin as easily as a message - to friends, family, or anyone else.",
    webCta: "Web app",
    googlePlayCta: "Google Play",
    androidApkCta: "Android APK",
    zapstoreCta: "Zapstore",
    ctaMenuLabel: "App launch options",
    privacyLabel: "Privacy Policy",
    heroImageAlt: "The Linky app on a phone held in hand",
    followUsLabel: "Follow us",
    uspSectionTitle: "Why Linky",
    uspItems: [
      {
        title: "Send bitcoin like a message",
        description:
          "Pick a contact, enter an amount, and send money as naturally as sending a chat message.",
        imageSrc: "/contacts_mock.png",
        imageAlt: "Preview of sending bitcoin to a contact in the Linky app",
      },
      {
        title: "Request a payment",
        description:
          "Send a payment request directly in the chat so the other person can settle it with a single tap.",
        imageSrc: "/request_mock.png",
        imageAlt: "Preview of requesting a payment in the Linky app",
      },
      {
        title: "Send bitcoin even to people without a wallet",
        description:
          "You can prepare a payment for someone who does not have a wallet yet. Linky makes the handoff simple.",
        imageSrc: "/issue_mock.png",
        imageAlt:
          "Preview of sending bitcoin to people without a wallet in the Linky app",
      },
    ],
    closingSectionTitle: "Privacy",
    closingSectionDescription:
      "Users do not need a phone number, email address, or any identity documents.",
    closingImageAlt:
      "Preview of private Linky usage without personal information",
  },
  de: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    switchLabel: "Sprache",
    title: "Baue dein Bitcoin-Netzwerk auf",
    subtitle:
      "Mit jeder Zahlung wächst dein Netzwerk und deine Beziehungen werden stärker. Mit Linky sendest du Bitcoin so einfach wie eine Nachricht – an Freunde, Familie oder alle anderen.",
    webCta: "Web-App",
    googlePlayCta: "Google Play",
    androidApkCta: "Android APK",
    zapstoreCta: "Zapstore",
    ctaMenuLabel: "Optionen zum Öffnen der App",
    privacyLabel: "Datenschutz",
    heroImageAlt: "Die Linky-App auf einem Smartphone in der Hand",
    followUsLabel: "Folge uns",
    uspSectionTitle: "Warum Linky",
    uspItems: [
      {
        title: "Sende Bitcoin wie eine Nachricht",
        description:
          "Wähle einen Kontakt, gib einen Betrag ein und sende Geld so einfach wie eine Chatnachricht.",
        imageSrc: "/contacts_mock.png",
        imageAlt:
          "Vorschau einer Bitcoin-Zahlung an einen Kontakt in der Linky-App",
      },
      {
        title: "Fordere eine Zahlung an",
        description:
          "Sende eine Zahlungsanforderung direkt im Chat, damit die andere Person sie mit einem Tippen begleichen kann.",
        imageSrc: "/request_mock.png",
        imageAlt: "Vorschau einer Zahlungsanforderung in der Linky-App",
      },
      {
        title: "Sende Bitcoin auch an Menschen ohne Wallet",
        description:
          "Du kannst eine Zahlung für jemanden vorbereiten, der noch keine Wallet hat. Linky macht die Übergabe einfach.",
        imageSrc: "/issue_mock.png",
        imageAlt:
          "Vorschau einer Bitcoin-Zahlung an Menschen ohne Wallet in der Linky-App",
      },
    ],
    closingSectionTitle: "Datenschutz",
    closingSectionDescription:
      "Nutzer benötigen weder Telefonnummer noch E-Mail-Adresse oder Ausweisdokumente.",
    closingImageAlt:
      "Vorschau der privaten Linky-Nutzung ohne persönliche Daten",
  },
};

const getDefaultCtaMode = (): CtaMode => {
  if (typeof navigator === "undefined") {
    return "web";
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const isAndroid = userAgent.includes("android");
  const isMobile = userAgent.includes("mobile");

  return isAndroid && isMobile ? "google-play" : "web";
};

const launchApp = (mode: CtaMode) => {
  if (mode === "google-play" && /android/i.test(navigator.userAgent)) {
    window.location.assign(
      `intent://play.google.com/store/apps/details?id=fit.linky.app#Intent;scheme=https;package=com.android.vending;S.browser_fallback_url=${encodeURIComponent(ctaUrls.web)};end`,
    );
    return;
  }

  window.open(ctaUrls[mode], "_blank", "noopener,noreferrer");
};

function AppLaunch({ copy, wide }: { copy: LocaleCopy; wide: boolean }) {
  const [mode, setMode] = useState<CtaMode>(getDefaultCtaMode);
  const labels: Record<CtaMode, string> = {
    "android-apk": copy.androidApkCta,
    "google-play": copy.googlePlayCta,
    web: copy.webCta,
    zapstore: copy.zapstoreCta,
  };
  const launchButton = (
    <Button icon="ArrowUpRight" onPress={() => launchApp(mode)}>
      {labels[mode]}
    </Button>
  );
  const modePicker = (
    <SelectField
      label={copy.ctaMenuLabel}
      value={mode}
      options={ctaModes.map((value) => ({ value, label: labels[value] }))}
      onValueChange={setMode}
    />
  );

  return wide ? (
    <Row gap="$lg" alignItems="flex-end" maxWidth="$sheetWidth">
      <Stack flex={1}>{launchButton}</Stack>
      <Stack flex={1}>{modePicker}</Stack>
    </Row>
  ) : (
    <Stack gap="$md">
      {modePicker}
      {launchButton}
    </Stack>
  );
}

function App() {
  const [locale, setLocale] = useSiteLocale();
  const { wide } = useMedia();
  const activeCopy = copy[locale];
  const Columns = wide ? Row : Stack;

  return (
    <SiteLayout copy={activeCopy} locale={locale} onLocaleChange={setLocale}>
      <Stack gap="$huge" paddingTop="$xxl" paddingBottom="$huge">
        <Columns gap={wide ? "$huge" : "$xxxl"}>
          <Stack flex={wide ? 1 : undefined} gap="$xxl">
            <Stack gap="$lg">
              <Text
                variant={wide ? "amount" : "display"}
                color="$colorStrong"
                role="heading"
                aria-level={1}
              >
                {activeCopy.title}
              </Text>
              <Text color="$colorMuted">{activeCopy.subtitle}</Text>
            </Stack>
            <AppLaunch copy={activeCopy} wide={wide} />
          </Stack>
          <Image
            flex={wide ? 1 : undefined}
            src="/app_in_hand.png"
            alt={activeCopy.heroImageAlt}
            width="100%"
            height={wide ? "$sheetWidth" : "$qr"}
            objectFit="contain"
          />
        </Columns>

        <Stack gap="$xxl">
          <Text
            variant="display"
            color="$colorStrong"
            role="heading"
            aria-level={2}
          >
            {activeCopy.uspSectionTitle}
          </Text>
          <Columns gap={wide ? "$xxl" : "$lg"} alignItems="stretch">
            {activeCopy.uspItems.map((item) => (
              <Card key={item.title} outlined flex={wide ? 1 : undefined}>
                <Image
                  src={item.imageSrc}
                  alt={item.imageAlt}
                  width="100%"
                  height="$qr"
                  objectFit="contain"
                />
                <Text
                  variant="title"
                  color="$colorStrong"
                  role="heading"
                  aria-level={3}
                >
                  {item.title}
                </Text>
                <Text color="$colorMuted">{item.description}</Text>
              </Card>
            ))}
          </Columns>
        </Stack>

        <Card outlined padding={wide ? "$xxl" : "$lg"}>
          <Columns gap="$xxl" alignItems={wide ? "center" : "stretch"}>
            <Stack flex={wide ? 1 : undefined} gap="$sm">
              <Text
                variant={wide ? "display" : "heading"}
                color="$colorStrong"
                role="heading"
                aria-level={2}
              >
                {activeCopy.closingSectionTitle}
              </Text>
              <Text color="$colorMuted">
                {activeCopy.closingSectionDescription}
              </Text>
            </Stack>
            <Row
              gap="$xxl"
              justifyContent="center"
              role="img"
              aria-label={activeCopy.closingImageAlt}
            >
              <Icon name="PhoneOff" size="xl" color="$colorStrong" />
              <Icon name="MailOff" size="xl" color="$colorStrong" />
              <Icon name="IdCardOff" size="xl" color="$colorStrong" />
            </Row>
          </Columns>
        </Card>
      </Stack>
    </SiteLayout>
  );
}

export default App;
