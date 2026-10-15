import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, Heading, Paragraph } from "../../prose";

export function Body() {
  return (
    <>
      <Heading>Smazání zprávy u obou stran</Heading>
      <Paragraph>
        Odeslanou zprávu jste zatím mohli jen upravit, teď jde i smazat. Na long
        press nebo press na 3 tečky otevřete submenu a zvolte Smazat. Text i
        reakce zmizí na obou telefonech a oběma zůstane na jejím místě „Zpráva
        byla smazána“. Funguje to stejně jako třeba v Signalu.
      </Paragraph>

      <Heading>Reakce jakýmkoli emoji</Heading>
      <Paragraph>
        Řádek s reakcemi nemá už jen šest emoji, ale lze vybrat z celého seznamu
        emoji.
      </Paragraph>
      <DemoFigure
        screen="message-actions"
        caption="Dave chtěl poslat zprávu mámě, ale poslal ji Mie. Nevadí, prostě ji smaže!"
      />

      <Heading>Smazání a blokování kontaktů</Heading>
      <Paragraph>
        Místo archivace lze kontakt z Linky odstranit. Stačí klepnout na ikonku
        koše v horní liště. Konverzace zmizí a v případě, že vám dotyčný znovu
        napíše, kontakt se vrátí s celou historií.
      </Paragraph>
      <Paragraph>
        V Linky taky jde zablokovat spam. V takovém případě vám zablokovaný
        profil nebude moct napsat a nic se neuloží ani nezobrazí.
      </Paragraph>
      <DemoFigure
        screen="contact-block"
        caption="Dave smaže kontakt, který mu posílá spam, zablokuje ho z oznámení a najde ho v Nastavení na stránce Blokovaní."
      />
      <Paragraph>
        Odblokovat zablokované kontakty jde v Nastavení. Blokace se automaticky
        synchronizuje mezi zařízeními.
      </Paragraph>

      <Heading>Notifikace na Androidu bez Googlu</Heading>
      <Paragraph>
        Aplikace pro Android doručovala notifikace přes Firebase, a ten
        potřebuje Google Play Services. Na GrapheneOS a dalších telefonech bez
        nich zapnutí notifikací prostě selhalo. Na takových telefonech proto
        nešly ani proxy platby, protože ty notifikace potřebují.
      </Paragraph>
      <Paragraph>
        Kde Play Services chybí, používá teď Linky UnifiedPush. Nainstalujte si
        UnifiedPush aplikaci, třeba{" "}
        <TextLink href="https://ntfy.sh">ntfy</TextLink>, a pak zapněte
        Notifikace v Nastavení. Když žádnou takovou aplikaci nemáte, Linky vám
        řekne, ať si ji nainstalujete. Na telefonech s Play Services se nic
        nemění.
      </Paragraph>

      <Heading>Obnova účtu jedním vložením</Heading>
      <Paragraph>
        Hezčí obnova účtu ze SLIP-39. Spíš kosmetická změna, ale může být taky
        užitečná. Seed jde samozřejmě pořád vložit ze schránky zařízení.
      </Paragraph>
      <DemoFigure
        screen="restore-paste"
        caption="Dave obnoví účet na novém telefonu vložením zálohy."
      />
      <Paragraph>
        Pokud si svůj recovery seed pamatujete nazpaměť (ok, woow 😅), nebo ho z
        jiného důvodu píšete ručně, Linky vám teď hezky doplňuje slova podle
        slovníku SLIP-39.
      </Paragraph>

      <Heading>Tutoriál kdykoli znovu</Heading>
      <Paragraph>
        V Nastavení přibyla stránka Tutoriál. Najdete na ní kroky Začínáme a
        kterýkoli z nich si můžete projít znovu, i když už ho máte hotový. Hodí
        se, když zapomenete, kde něco je, nebo když ukazujete Linky kamarádovi.
      </Paragraph>
      <DemoFigure
        screen="tutorial-replay"
        caption="Dave si v Nastavení na stránce Tutoriál znovu projde, jak zaplatit kontaktu."
      />

      <Heading>Co je v této verzi dál</Heading>
      <BulletList
        items={[
          <>
            V Nastavení v části Zabezpečení je nová stránka Nostr identita.
            Ukazuje identitu, kterou používáte, s profilem, lightning adresou a
            npubem a zkopíruje npub nebo nsec. Vlastní identita, kterou jste
            vložili, zůstane k zařízení připojená, takže mezi ní a identitou
            vytvořenou v Linky můžete přepínat.
          </>,
          <>
            Jednotka ₿ teď ukazuje bitcoiny, třeba 0,00123456 ₿, místo satů se
            symbolem bitcoinu. Klávesnice v ní přijme až osm desetinných míst.
            Desetinná místa na klávesnici jsou zapnutá ve výchozím stavu,
            vypnout je jde v Nastavení v Jednotkách.
          </>,
          <>
            Klepnutím na token v chatu přepnete jednotku, ve které se ukazuje,
            stejně jako u zůstatku v peněžence.
          </>,
          <>
            Přidat kontakt začíná tlačítkem Načíst QR kontaktu. Zapsanou
            lightning adresu jde uložit hned a do hledání můžete vložit odkaz na
            profil linky.fit/p/.
          </>,
          <>
            Sdílet profil otevře nabídku, kde zkopírujete odkaz na profil nebo
            npub, nebo otevřete sdílení telefonu. QR kód v záložce Profil zase
            obsahuje jen váš npub, takže ho přečtou i jiné Nostr aplikace.
          </>,
          <>
            Linky umí přijmout P2PK Cashu tokeny uzamčené na váš npub. Dřív je
            odmítalo.
          </>,
          <>
            Aplikace pro Android dostává webové aktualizace, aniž by čekala na
            vydání v Google Play. Stáhne podepsanou aktualizaci a přepne na ni
            při dalším čistém spuštění nebo po klepnutí na lištu s aktualizací,
            nikdy uprostřed platby.
          </>,
          <>
            Linky už samo nemaže staré zprávy. Dřív dlouhé historie zkracovalo
            na všech zařízeních.
          </>,
          <>
            Nabídka proxy platby ukazuje hned vedle částky, jestli je bankovní
            převod v CZK, EUR nebo BRL.
          </>,
          <>
            V aplikaci pro Android a iOS zůstává stavový řádek čitelný i ve
            světlém režimu a otevřený chat se méně překresluje, což poznáte v
            dlouhých konverzacích.
          </>,
          <>Aplikace pro Android teď vyžaduje Android 7.0 nebo novější.</>,
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
        vydaná verze. Všechno z tohoto článku tam běželo jako první.
      </Paragraph>
      <Paragraph>
        Počítejte s tím, že tu a tam něco drhne. Když na to narazíte, dejte nám
        vědět.
      </Paragraph>
    </>
  );
}
