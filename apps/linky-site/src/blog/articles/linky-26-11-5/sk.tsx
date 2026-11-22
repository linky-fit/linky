import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, FigureRow, Heading, Paragraph, Term } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Vyšiel Linky 26.11.5. Aplikácia aj web teraz hovoria po slovensky,
        on-chain prevody bežia non-stop a platby z dlho používaných peňaženiek
        sú zhruba dvakrát rýchlejšie.
      </Paragraph>

      <Heading>Linky hovorí po slovensky</Heading>
      <Paragraph>
        Kto doteraz otvoril Linky na slovenskom telefóne, dostal angličtinu. Od
        verzie 26.11.5 hovorí po slovensky celá aplikácia aj web linky.fit.
        Slovenský prehliadač si ju vyberie sám, alebo ju prepnete v{" "}
        <Term>Nastaveniach</Term> pod položkou <Term>Jazyk</Term> voľbou{" "}
        <Term>Slovenčina</Term>.
      </Paragraph>
      <Paragraph>
        Nové účty v slovenčine začínajú s eurami, formátujú dátumy aj čísla po
        slovensky a vedia hľadať emoji podľa slovenských slov v reakciách aj v
        správach po dvojbodke.
      </Paragraph>

      <Heading>On-chain prevody bežia non-stop</Heading>
      <Paragraph>
        Bitcoin medzi Linky a klasickou on-chain peňaženkou presuniete cez{" "}
        <Term>Odoslať do on-chain peňaženky</Term> a{" "}
        <Term>Prijať z on-chain peňaženky</Term>. Doteraz bola služba občas
        nedostupná, takže sa nikto nemôže čudovať, ak ste na ňu pozabudli. Teraz
        už má bežať non-stop. Ak chcete presunúť saty na hardvérovú peňaženku
        alebo naopak poslať bitcoin z on-chain peňaženky do Linky, pokojne to
        vyskúšajte.
      </Paragraph>
      <Paragraph>
        Odoslanie na on-chain sa navyše ľahšie sleduje. Na obrazovke prevodu
        teraz vidíte svoju cieľovú adresu a tlačidlo{" "}
        <Term>Otvoriť adresu v prehliadači</Term>, ktoré ju otvorí v prehliadači
        blockchainu. Keď platba dorazí na on-chain, otvorenie odkazu transakciu
        skontroluje a rovno označí prevod ako hotový.
      </Paragraph>
      <FigureRow>
        <DemoFigure
          screen="slovak-language"
          caption="Prepnutie Jazyka na Slovenčina preloží celú aplikáciu a zobrazí zostatok v eurách."
        />
        <DemoFigure
          screen="onchain-send"
          caption="Dave pošle 100 000 sat do on-chain peňaženky, otvorí cieľovú adresu v prehliadači a prevod sa označí ako hotový."
        />
      </FigureRow>

      <Heading>Rýchlejšie platby a plynulejšia synchronizácia</Heading>
      <Paragraph>
        Peňaženka by teraz mala byť citeľne rýchlejšia, aj keď v nej máte veľa
        Cashu tokenov. Platby z dlhšie používanej peňaženky zvláda zhruba
        dvakrát rýchlejšie ako predtým.
      </Paragraph>
      <Paragraph>
        Plynulejšia je aj synchronizácia medzi zariadeniami. Správy, kontakty,
        ponuky aj história platieb držia medzi telefónom a počítačom krok bez
        jediného prepínača navyše. Vaše dáta sa pri prvom otvorení verzie
        26.11.5 prevedú samy. Ak máte Linky na viacerých zariadeniach,
        aktualizujte prosím všetky, aby spolu zostali zosynchronizované.
      </Paragraph>

      <Heading>Ďalšie opravy v tejto verzii</Heading>
      <BulletList
        items={[
          <>
            Čakajúca Lightning platba sa ukáže ako zaplatená v priebehu pár
            sekúnd po vybavení, bez reštartu aplikácie.
          </>,
          <>
            Prijaté tokeny sa rovno hlásia ako prijaté namiesto toho, aby
            preblikli ako neplatné.
          </>,
          <>Rýchlo za sebou poslané správy držia poradie, v akom odišli.</>,
          <>
            História platieb ukazuje pri Lightning platbách celý poplatok a
            žiadosť o platbu označí ako zaplatenú hneď, ako dorazí celá suma.
          </>,
          <>
            Hľadanie kontaktu podľa overenej adresy skryje falošné profily,
            ktoré si tú istú adresu len privlastňujú.
          </>,
        ]}
      />

      <Heading>Chcete novinky skôr? Skúste nightly</Heading>
      <Paragraph>
        Ak nechcete čakať na release, používajte nightly na{" "}
        <TextLink href="https://nightly.app.linky.fit">
          nightly.app.linky.fit
        </TextLink>
        . Nasadzuje sa tam každá zmena, ktorú zlúčime do mainu, a beží na
        rovnakých produkčných relayoch, mintoch a sync serveroch ako release.
        Všetko z tohto článku tam bežalo ako prvé.
      </Paragraph>
      <Paragraph>
        Počítajte s tým, že občas niečo zadrhne. Keď na to narazíte, dajte nám
        vedieť.
      </Paragraph>
    </>
  );
}
