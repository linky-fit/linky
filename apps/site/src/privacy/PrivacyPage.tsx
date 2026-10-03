import { Stack, Text } from "@linky-fit/ui";
import { useEffect } from "react";
import { SiteLayout, type SiteLayoutCopy } from "../SiteLayout";
import type { SiteLocale } from "../sitePreferences";
import { useSiteLocale } from "../useSiteLocale";

interface PrivacyCopy extends SiteLayoutCopy {
  documentTitle: string;
  eyebrow: string;
  title: string;
  paragraphs: readonly string[];
  deleteTitle: string;
  deleteParagraphs: readonly string[];
}

const copy: Record<SiteLocale, PrivacyCopy> = {
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
    documentTitle: "Linky Ochrana soukromí",
    eyebrow: "Ochrana soukromí",
    title: "Ochrana soukromí",
    paragraphs: [
      "Linky je local-first aplikace pro kontakty, soukromé zprávy a bitcoinové platby. Veškerá data jsou přístupná pouze uživateli. Provozovatel aplikace nemá přístup ani ke zprávám, ani ke kontaktům, ani k informaci o množství tokenů.",
      "Data jsou synchronizována přes Evolu a Nostr relays. Číst je však dokáže opět pouze uživatel. Aplikace využívá také Cashu minty třetích stran k emisi tokenů a nabízí volitelné push notifikace.",
      "Soukromé klíče jsou plně pod kontrolou uživatele. Provozovatel aplikace nedokáže obnovovat uživatelské údaje, protože jimi nedisponuje.",
      "Tento web na linky.fit může zpracovávat běžné technické logy hostingu a zabezpečení. Produktová aplikace na app.linky.fit může odesílat i síťové požadavky nutné pro funkčnost aplikace, včetně požadavků na relays, minty, LNURL služby a volitelnou Linky push službu.",
      "Protože Linky využívá decentralizované a třetí stranou provozované systémy, nelze vždy zaručit úplné smazání dat, která už byla mimo tvé zařízení publikována nebo dále relayována.",
    ],
    deleteTitle: "Jak smazat svá data",
    deleteParagraphs: [
      "Linky neprovozuje klasický serverový uživatelský účet, ve kterém by provozovatel přímo uchovával nebo mohl mazat tvé kontakty, soukromé zprávy nebo zůstatek peněženky. Většinu dat v Linky máš pod kontrolou ty sám ve svém zařízení a pod svou kryptografickou identitou.",
      "Chceš-li smazat data Linky uložená v zařízení, použij v aplikaci možnosti pro odhlášení a vyčištění lokálních dat v Nastavení nebo v Pokročilých volbách, případně smaž data aplikace v zařízení a aplikaci odinstaluj.",
      "Pokud máš zapnuté push notifikace, vypni je v aplikaci nebo v nastavení zařízení, aby se zastavilo budoucí doručování. Související metadata push odběru mohou na službě Linky push zůstat po omezenou technickou dobu a následně jsou odstraněna v rámci odhlášení nebo úklidových procesů.",
      "Data, která jsi dříve publikoval do decentralizovaných Nostr relayů nebo odeslal službám třetích stran, například relayům, Cashu mintům nebo LNURL službám, nemusí být možné po opuštění tvého zařízení plně odstranit ani ze strany Linky, ani ze strany provozovatele Linky.",
      "Linky nedokáže obnovit smazané klíče ani znovu sestavit smazaná lokální šifrovaná data.",
    ],
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
    documentTitle: "Linky Privacy Policy",
    eyebrow: "Privacy Policy",
    title: "Privacy Policy",
    paragraphs: [
      "Linky is a local-first application for contacts, private messages, and bitcoin payments. All data is accessible only to the user. The operator of the app has no access to messages, contacts, or information about the amount of tokens.",
      "Data is synchronized through Evolu and Nostr relays. However, it can again be read only by the user. The app also uses third-party Cashu mints to issue tokens and offers optional push notifications.",
      "Private keys remain fully under the user's control. The operator cannot recover user data because it does not possess it.",
      "This website at linky.fit may process standard technical hosting and security logs. The product app at app.linky.fit may also send network requests necessary for the app to function, including requests to relays, mints, LNURL services, and the optional Linky push service.",
      "Because Linky relies on decentralized systems and systems operated by third parties, it is not always possible to guarantee complete deletion of data that has already been published or further relayed outside your device.",
    ],
    deleteTitle: "How to delete your data",
    deleteParagraphs: [
      "Linky does not operate a traditional server-side user account that stores your contacts, private messages, or wallet balance in a way the operator can directly inspect or erase on your behalf. Most Linky data is controlled by you on your device and through your own cryptographic identity.",
      "To delete Linky data stored on your device, use the in-app logout and local data reset options in Settings or Advanced, or remove the app data from your device and uninstall the app.",
      "If you enabled push notifications, disable notifications in the app or on your device to stop future push delivery. Related push subscription metadata may remain on the Linky push service for a limited technical period and is then removed as part of unsubscribe or cleanup flows.",
      "Data that you previously published to decentralized Nostr relays or sent to third-party services such as relays, Cashu mints, or LNURL services may not be fully deletable by Linky or by the Linky operator once it has left your device.",
      "Linky cannot recover deleted keys or reconstruct deleted local encrypted data.",
    ],
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
    documentTitle: "Linky Datenschutz",
    eyebrow: "Datenschutz",
    title: "Datenschutzerklärung",
    paragraphs: [
      "Linky ist eine Local-First-Anwendung für Kontakte, private Nachrichten und Bitcoin-Zahlungen. Alle Daten sind nur für den Nutzer zugänglich. Der Betreiber der App hat keinen Zugriff auf Nachrichten, Kontakte oder Informationen über die Token-Beträge.",
      "Die Daten werden über Evolu und Nostr-Relays synchronisiert, können jedoch weiterhin nur vom Nutzer gelesen werden. Die App verwendet außerdem Cashu-Mints von Drittanbietern zur Ausgabe von Token und bietet optionale Push-Benachrichtigungen.",
      "Private Schlüssel bleiben vollständig unter der Kontrolle des Nutzers. Der Betreiber kann Nutzerdaten nicht wiederherstellen, da er nicht über sie verfügt.",
      "Diese Website unter linky.fit kann übliche technische Hosting- und Sicherheitsprotokolle verarbeiten. Die Produkt-App unter app.linky.fit kann außerdem für ihre Funktion notwendige Netzwerkanfragen senden, darunter Anfragen an Relays, Mints, LNURL-Dienste und den optionalen Linky-Push-Dienst.",
      "Da Linky auf dezentralen und von Drittanbietern betriebenen Systemen beruht, kann die vollständige Löschung bereits veröffentlichter oder außerhalb deines Geräts weitergeleiteter Daten nicht immer garantiert werden.",
    ],
    deleteTitle: "So löschst du deine Daten",
    deleteParagraphs: [
      "Linky betreibt kein herkömmliches serverseitiges Benutzerkonto, in dem der Betreiber deine Kontakte, privaten Nachrichten oder dein Wallet-Guthaben direkt einsehen oder für dich löschen könnte. Die meisten Linky-Daten kontrollierst du selbst auf deinem Gerät und über deine kryptografische Identität.",
      "Um auf deinem Gerät gespeicherte Linky-Daten zu löschen, nutze in der App die Optionen zum Abmelden und Zurücksetzen lokaler Daten unter Einstellungen oder Erweitert. Alternativ kannst du die App-Daten auf deinem Gerät löschen und die App deinstallieren.",
      "Wenn du Push-Benachrichtigungen aktiviert hast, deaktiviere sie in der App oder auf deinem Gerät. Zugehörige Metadaten des Push-Abonnements können für einen begrenzten technischen Zeitraum auf dem Linky-Push-Dienst verbleiben und werden danach beim Abmelden oder bei Bereinigungen entfernt.",
      "Daten, die du zuvor auf dezentralen Nostr-Relays veröffentlicht oder an Drittanbieter wie Relays, Cashu-Mints oder LNURL-Dienste gesendet hast, können von Linky oder dem Linky-Betreiber möglicherweise nicht vollständig gelöscht werden, nachdem sie dein Gerät verlassen haben.",
      "Linky kann gelöschte Schlüssel nicht wiederherstellen und gelöschte lokale verschlüsselte Daten nicht rekonstruieren.",
    ],
  },
};

function PrivacyPage() {
  const [locale, setLocale] = useSiteLocale();
  const activeCopy = copy[locale];

  useEffect(() => {
    document.title = activeCopy.documentTitle;
  }, [activeCopy.documentTitle]);

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
        {activeCopy.paragraphs.map((paragraph) => (
          <Text key={paragraph} variant="body">
            {paragraph}
          </Text>
        ))}
        <Stack id="how-to-delete-your-data" gap="$xxl" paddingTop="$lg">
          <Text
            variant="heading"
            color="$colorStrong"
            role="heading"
            aria-level={2}
          >
            {activeCopy.deleteTitle}
          </Text>
          {activeCopy.deleteParagraphs.map((paragraph) => (
            <Text key={paragraph} variant="body">
              {paragraph}
            </Text>
          ))}
        </Stack>
      </Stack>
    </SiteLayout>
  );
}

export default PrivacyPage;
