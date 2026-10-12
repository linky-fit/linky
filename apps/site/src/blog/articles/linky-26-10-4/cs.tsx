import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, Heading, Paragraph } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Linky 26.10.4 je venku. Většina novinek se týká toho, co ve vašem Linky
        zůstane: které zprávy zůstanou v konverzaci, kdo zůstane v kontaktech a
        kdo vám vůbec může napsat. Začnu tím, pak přijdou notifikace na Androidu
        bez Googlu, nová obnova účtu a zbytek vydání.
      </Paragraph>

      <Heading>Smazání zprávy u obou stran</Heading>
      <Paragraph>
        Odeslanou zprávu jste zatím mohli jen upravit. Teď má menu zprávy i
        Smazat. Na telefonu podržte na zprávě prst, na počítači klikněte na tři
        tečky vedle ní. Pak zvolte Smazat. Text i reakce zmizí na obou
        telefonech a oběma zůstane na jejím místě „Zpráva byla smazána“, takže
        konverzace dál dává smysl.
      </Paragraph>
      <Paragraph>
        Smazat jde jakoukoli zprávu v konverzaci včetně fotek a souborů, i tu od
        druhé strany. Tokeny, žádosti o platbu a nabídky proxy plateb tlačítko
        Smazat nemají. Druhá strana potřebuje také verzi 26.10.4. Starší verze
        zprávu dál ukazuje.
      </Paragraph>

      <Heading>Reakce jakýmkoli emoji</Heading>
      <Paragraph>
        Řádek reakcí ve stejném menu měl šest emoji. Vedle nich je teď tlačítko
        plus, které otevře celý seznam emoji rozdělený do záložek jako na
        klávesnici. Vybrané emoji se pod zprávou ukáže jako každá jiná reakce.
      </Paragraph>
      <DemoFigure
        screen="message-actions"
        caption="Dave reaguje na zprávu od Mii emoji z celého seznamu a pak smaže zprávu, která patřila mámě."
      />

      <Heading>Smazání a blokování kontaktů</Heading>
      <Paragraph>
        Kontakty se dřív přesouvaly do archivu, druhého seznamu, který skoro
        nikdo neotevíral. Teď je smažete. Otevřete úpravu kontaktu a klepněte na
        ikonu koše nahoře. Kontakt hned zmizí a oznámení nabídne Vrátit zpět.
        Konverzace se neztratí: když vám ten člověk znovu napíše, kontakt se
        vrátí i s celou historií.
      </Paragraph>
      <Paragraph>
        To se hodí pro někoho, s kým jste si jen přestali psát, ale ne na spam.
        Proto stejné oznámení nabízí i Blokovat a úprava kontaktu má tlačítko
        Blokovat, které kontakt smaže a zablokuje naráz. Linky pak všechno, co
        ten člověk pošle, ignoruje. Nic se neuloží ani nezobrazí a žádná zpráva
        ho zpátky nevrátí.
      </Paragraph>
      <DemoFigure
        screen="contact-block"
        caption="Dave smaže kontakt, který mu posílá spam, zablokuje ho z oznámení a najde ho v Nastavení na stránce Blokovaní."
      />
      <Paragraph>
        V Nastavení přibyla stránka Blokovaní se všemi, koho jste zablokovali, a
        u každého je tlačítko Odblokovat. Blokování i odblokování se
        synchronizuje na všechna vaše zařízení a na ostatních platí hned. Po
        odblokování projdou nové zprávy.
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
        Při obnově účtu jste dosud psali všech 20 slov zálohy do jednoho pole.
        Správce hesel ho neuměl vyplnit a překlep se v něm hledal špatně.
        Obrazovka obnovy má teď tlačítko Vložit ze schránky, které vezme celou
        zálohu najednou. Vyplní všech 20 polí a samo pokračuje dál.
      </Paragraph>
      <DemoFigure
        screen="restore-paste"
        caption="Dave obnoví účet na novém telefonu vložením zálohy."
      />
      <Paragraph>
        Pokud máte slova na papíře, napište je do 20 polí jedno po druhém. Linky
        každé slovo zkontroluje proti seznamu slov SLIP-39, označí ta, která
        nezná, a při psaní nabízí slova k doplnění. 3. a 4. slovo je v záloze
        Linky vždy „academic“, není to překlep. Správce hesel, který má zálohu
        uloženou pro app.linky.fit, umí vyplnit první pole a Linky slova rozdělí
        do ostatních.
      </Paragraph>

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
            V Nastavení v Tutoriálu najdete všechny kroky Začínáme a kterýkoli z
            nich můžete projít znovu, i když už ho máte splněný.
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
        Nightly sdílí účty s aktuálním vydáním. Obnovte v ní účet ze svých
        hlavních klíčů, teď už jedním vložením, a připojí se jako další
        zařízení. Běží na vlastní adrese, takže má i vlastní lokální úložiště.
        Verzi nightly najdete v Nastavení &gt; Pokročilé.
      </Paragraph>
      <Paragraph>
        Počítejte s tím, že tu a tam něco drhne. Když na to narazíte, dejte nám
        vědět.
      </Paragraph>

      <Heading>Vyzkoušejte to</Heading>
      <Paragraph>
        Linky běží v prohlížeči na{" "}
        <TextLink href="https://app.linky.fit">app.linky.fit</TextLink> a
        najdete ho i na Google Play a Zapstore. Podržte prst na zprávě, klepněte
        na plus a vyberte emoji, které ve starém řádku nebylo.
      </Paragraph>
    </>
  );
}
