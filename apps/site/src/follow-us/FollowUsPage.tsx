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
    <div className="follow-link">
      <a
        className="follow-link-main"
        href={href}
        target={opensNewTab ? "_blank" : undefined}
        rel={opensNewTab ? "noreferrer" : undefined}
      >
        <img className="follow-link-icon" src={iconSrc} alt="" />
        <span className="follow-link-text">
          <span className="follow-link-title">{title}</span>
          <span className="follow-link-detail">{detail}</span>
        </span>
      </a>
      {action}
    </div>
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
    <button
      className="follow-copy"
      type="button"
      onClick={() => {
        void copyTextToClipboard(value).then(setCopied);
      }}
    >
      {copied ? copiedLabel : copyLabel}
    </button>
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
      <section className="follow-section">
        <p className="eyebrow">{activeCopy.eyebrow}</p>
        <h1>{activeCopy.title}</h1>

        <div className="follow-links">
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
        </div>
      </section>
    </SiteLayout>
  );
}

export default FollowUsPage;
