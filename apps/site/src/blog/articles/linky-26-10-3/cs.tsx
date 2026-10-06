import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, Heading, Paragraph } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Linky 26.10.3 vyšlo 5. října. Hlavní novinkou je sdílení profilu, a
        proto se mu věnuje většina článku. Ostatní změny najdete níž.
      </Paragraph>

      <Heading>Odkaz místo npubu</Heading>
      <Paragraph>
        Když jste dosud chtěli, aby si vás někdo v Linky přidal, poslali jste mu
        npub nebo mu ukázali QR kód. Npub je dlouhý řetězec znaků a člověku,
        který Linky ještě nepoužívá, nic neřekne.
      </Paragraph>
      <Paragraph>
        Teď má každý uživatel Linky svou profilovou stránku. Pokud máte na
        linky.fit vlastní lightning adresu, končí odkaz na profil jejím jménem,
        třeba linky.fit/p/dave. Bez vlastního jména je v odkazu váš npub.
      </Paragraph>
      <Paragraph>
        Odkaz sdílíte v záložce Profil tlačítkem Sdílet profil. Otevře se
        systémová nabídka sdílení a vyberete, komu ho pošlete. Prohlížeče na
        počítači, které sdílet neumí, odkaz místo toho zkopírují do schránky.
      </Paragraph>
      <DemoFigure
        screen="profile-share"
        caption="Dave posílá Mii odkaz na svůj profil ze záložky Profil."
      />
      <Paragraph>
        Signal, WhatsApp, Telegram a další chatovací aplikace z odkazu udělají
        náhled s vaším jménem, obrázkem a popisem. Příjemce tak ví, od koho
        zpráva je, ještě než na cokoli klepne.
      </Paragraph>

      <Heading>Co uvidí druhá strana</Heading>
      <Paragraph>
        Na stránce je vaše jméno a obrázek, lightning adresa, status, měny,
        které nabízíte pro proxy platby, a popis. Pod tím je tlačítko Otevřít v
        Linky.
      </Paragraph>
      <Paragraph>
        Otevřít v Linky vás uloží do kontaktů a otevře konverzaci, ve které už
        je napsané „Ahoj 👋“. Stačí odeslat a máte odpověď. Víc v tom není.
      </Paragraph>
      <DemoFigure
        screen="profile-open"
        caption="Mia otevře odkaz, klepne na Otevřít v Linky a pozdraví Davea."
      />
      <Paragraph>
        Kdo ještě nemá účet v Linky, tomu odkaz počká, než si účet založí nebo
        obnoví, a pak konverzaci otevře. Pokud vás už v kontaktech má, otevře se
        stávající konverzace a druhý kontakt nevznikne.
      </Paragraph>

      <Heading>QR kód teď obsahuje taky odkaz</Heading>
      <Paragraph>
        QR kód v záložce Profil teď obsahuje váš odkaz na profil. Stačí na něj
        namířit fotoaparát libovolného telefonu a otevře se profilová stránka,
        takže člověk naproti vám nepotřebuje Linky, aby viděl, kdo jste. Skener
        v Linky ho dál načte jako kontakt, a pokud vás už má uloženého, najde
        existující kontakt.
      </Paragraph>

      <Heading>Co je v této verzi dál</Heading>
      <BulletList
        items={[
          <>
            Přihlášení na weby přes Nostr identitu: naskenujte nebo otevřete
            odkaz nostrconnect:// a potvrďte.
          </>,
          <>
            Z Nastavení můžete odebírat oznámení firem (Keryx). Funkce je
            experimentální a objeví se, až zapnete experimentální funkce.
          </>,
          <>
            Zprávy od kontaktu, kterého máte uloženého dvakrát, zůstávají v
            jedné konverzaci.
          </>,
          <>
            Opravili jsme úpravu profilu s vlastní identitou a tlačítka
            peněženky na malých displejích.
          </>,
        ]}
      />

      <Heading>Novinky dřív? Zkuste nightly</Heading>
      <Paragraph>
        Pokud nechcete čekat na vydání, používejte nightly na{" "}
        <TextLink href="https://nightly.app.linky.fit">
          nightly.app.linky.fit
        </TextLink>
        . Nasazuje se po každé změně, kterou začleníme do main, a běží proti
        stejným produkčním relayům, mintům a synchronizačním serverům jako
        vydaná verze.
      </Paragraph>
      <Paragraph>
        Nightly sdílí účty s aktuálním vydáním. Obnovte v ní účet ze svých
        hlavních klíčů a připojí se jako další zařízení. Běží na vlastní adrese,
        takže má i vlastní lokální úložiště. Verzi nightly najdete v Nastavení
        &gt; Pokročilé.
      </Paragraph>
      <Paragraph>
        Počítejte s tím, že tu a tam něco drhne. Když na to narazíte, dejte nám
        vědět.
      </Paragraph>

      <Heading>Vyzkoušejte to</Heading>
      <Paragraph>
        Linky běží v prohlížeči na{" "}
        <TextLink href="https://app.linky.fit">app.linky.fit</TextLink> a
        najdete ho i na Google Play a Zapstore. Pošlete odkaz na profil někomu,
        kdo Linky ještě nemá, a počkejte na jeho „Ahoj 👋“.
      </Paragraph>
    </>
  );
}
