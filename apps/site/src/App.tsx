import { useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeaderMenu } from "./SiteHeaderMenu";
import {
  getInitialSiteLocale,
  siteLocaleStorageKey,
  type SiteLocale,
} from "./sitePreferences";

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
  htmlLang: string;
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
  githubLabel: string;
  nostrLabel: string;
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
  "google-play":
    "https://play.google.com/store/apps/details?id=fit.linky.app&pli=1",
  web: "https://app.linky.fit",
  zapstore: "https://zapstore.dev/apps/fit.linky.app",
};

const copy: Record<SiteLocale, LocaleCopy> = {
  cs: {
    czechLabel: "Čeština",
    englishLabel: "English",
    germanLabel: "Deutsch",
    htmlLang: "cs",
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
    githubLabel: "GitHub",
    nostrLabel: "Nostr profil",
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
    htmlLang: "en",
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
    githubLabel: "GitHub",
    nostrLabel: "Nostr profile",
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
    htmlLang: "de",
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
    githubLabel: "GitHub",
    nostrLabel: "Nostr-Profil",
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

const isNodeTarget = (value: EventTarget | null): value is Node => {
  return value instanceof Node;
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

interface AppCtaProps {
  ctaMenuLabel: string;
  ctaMode: CtaMode;
  labels: Record<CtaMode, string>;
  onPrimaryAction: () => void;
  onSelectMode: (mode: CtaMode) => void;
}

function AppCta({
  ctaMenuLabel,
  ctaMode,
  labels,
  onPrimaryAction,
  onSelectMode,
}: AppCtaProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ctaMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!isNodeTarget(event.target)) {
        setMenuOpen(false);
        return;
      }

      if (!ctaMenuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  return (
    <div className="cta-row" ref={ctaMenuRef}>
      <div className="cta-group">
        <button className="primary-cta" type="button" onClick={onPrimaryAction}>
          {labels[ctaMode]}
        </button>
        <button
          className={menuOpen ? "cta-toggle is-open" : "cta-toggle"}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={ctaMenuLabel}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <span className="cta-toggle-icon" aria-hidden="true">
            ▾
          </span>
        </button>

        {menuOpen ? (
          <div className="cta-menu" role="menu">
            {ctaModes.map((mode) => (
              <button
                key={mode}
                className={
                  ctaMode === mode ? "cta-option is-selected" : "cta-option"
                }
                type="button"
                role="menuitemradio"
                aria-checked={ctaMode === mode}
                onClick={() => {
                  onSelectMode(mode);
                  setMenuOpen(false);
                }}
              >
                <span className="cta-option-label">{labels[mode]}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function App() {
  const [locale, setLocale] = useState<SiteLocale>(getInitialSiteLocale);
  const [ctaMode, setCtaMode] = useState<CtaMode>(getDefaultCtaMode);
  const [brandIsCompact, setBrandIsCompact] = useState(false);
  const activeCopy = useMemo(() => copy[locale], [locale]);

  useEffect(() => {
    document.documentElement.lang = activeCopy.htmlLang;
  }, [activeCopy.htmlLang]);

  useEffect(() => {
    window.localStorage.setItem(siteLocaleStorageKey, locale);
  }, [locale]);

  useEffect(() => {
    const updateBrand = () => {
      setBrandIsCompact(window.scrollY > 72);
    };

    updateBrand();
    window.addEventListener("scroll", updateBrand, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateBrand);
    };
  }, []);

  const handlePrimaryAction = () => {
    window.open(ctaUrls[ctaMode], "_blank", "noopener,noreferrer");
  };

  return (
    <main className="site-shell">
      <div className="site-backdrop" aria-hidden="true" />

      <header className="topbar">
        <a
          className={
            brandIsCompact
              ? "brand brand-floating is-compact"
              : "brand brand-floating"
          }
          href="/"
          aria-label="Linky home"
        >
          <span className="brand-mark">
            <img className="brand-logo" src="/icon.svg" alt="Linky" />
          </span>
          <span className="brand-word">Linky</span>
        </a>

        <SiteHeaderMenu
          copy={activeCopy}
          locale={locale}
          onLocaleChange={setLocale}
        />
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="hero-intro">
            <h1>{activeCopy.title}</h1>
            <p className="lede">{activeCopy.subtitle}</p>
          </div>

          <div className="hero-visual">
            <img
              className="hero-image"
              src="/app_in_hand.png"
              alt={activeCopy.heroImageAlt}
            />
          </div>
        </div>
      </section>

      <section className="usp-section" aria-label={activeCopy.uspSectionTitle}>
        <h2 className="usp-section-title">{activeCopy.uspSectionTitle}</h2>
        <div className="usp-grid">
          {activeCopy.uspItems.map((item) => {
            return (
              <article key={item.title} className="usp-card">
                <div className="usp-card-media">
                  <img src={item.imageSrc} alt={item.imageAlt} />
                </div>
                <div className="usp-card-copy">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="footer-section">
        <div className="closing-section">
          <div className="closing-copy">
            <h2>{activeCopy.closingSectionTitle}</h2>
            <p>{activeCopy.closingSectionDescription}</p>
          </div>

          <div className="closing-visual">
            <img
              className="closing-image"
              src="/not_personal.svg"
              alt={activeCopy.closingImageAlt}
            />
          </div>
        </div>

        <SiteFooter
          githubLabel={activeCopy.githubLabel}
          nostrLabel={activeCopy.nostrLabel}
          privacyLabel={activeCopy.privacyLabel}
        />
      </section>

      <div className="floating-cta">
        <AppCta
          ctaMenuLabel={activeCopy.ctaMenuLabel}
          ctaMode={ctaMode}
          labels={{
            "android-apk": activeCopy.androidApkCta,
            "google-play": activeCopy.googlePlayCta,
            web: activeCopy.webCta,
            zapstore: activeCopy.zapstoreCta,
          }}
          onPrimaryAction={handlePrimaryAction}
          onSelectMode={setCtaMode}
        />
      </div>
    </main>
  );
}

export default App;
