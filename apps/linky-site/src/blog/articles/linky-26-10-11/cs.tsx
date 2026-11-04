import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, FigureRow, Heading, Paragraph, Term } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Linky začalo chaty a platbami mezi přáteli. Díky proxy platbám vám
        kamarádi už mohli zaplatit bankovní převod a vzít si za to saty. Tahle
        verze jde dál: ze záložky <Term>Proxy platby</Term> v dolní liště je{" "}
        <Term>Spolupráce</Term> a najdete v ní tři způsoby, jak si za bitcoin
        navzájem pomáhat.
      </Paragraph>
      <BulletList
        items={[
          <>
            <Term>Platební převod</Term>: kamarád za vás zaplatí bankovní převod
            a vy mu pošlete saty. Proxy platby fungují stejně jako dřív, jen se
            posunuly o úroveň níž.
          </>,
          <>
            <Term>Hotovost</Term>: dejte kontaktům vědět, jestli máte hotovost
            navíc, nebo ji sháníte.
          </>,
          <>
            <Term>Zboží a služby</Term>: nabídněte, co vyrábíte nebo umíte, a
            podívejte se, co nabízejí a hledají vaše kontakty.
          </>,
        ]}
      />
      <Paragraph>
        Každá dlaždice ukazuje, co se v ní u vašich kontaktů děje: kolik jich
        platí převody, kolik směňuje hotovost a kolik mají nabídek.
      </Paragraph>

      <Heading>Hotovost</Heading>
      <Paragraph>
        Bitcoin je pořád nejlepší získat přímo od kamaráda za hotovost. Těžké je
        vědět, kdo má hotovost u sebe a kdo ji shání. Na stránce Hotovost
        zvolíte <Term>Nabízím hotovost</Term>, <Term>Teď nic</Term> nebo{" "}
        <Term>Poptávám hotovost</Term>. Pod tím vidíte, kdo z vašich kontaktů
        hotovost nabízí a kdo ji poptává.
      </Paragraph>
      <Paragraph>
        Vaši volbu vysílá i maják. Když ho máte zapnutý, kontakty v okolí uvidí
        nahoře v Kontaktech a ve vaší konverzaci, že bitcoin kupujete nebo
        prodáváte. Od verze 26.10.10 je maják dostupný všem a nepotřebuje
        zapnuté experimentální funkce.
      </Paragraph>

      <Heading>Zboží a služby</Heading>
      <Paragraph>
        Vajíčka ze zahrady, kváskový chleba, hlídání dětí, pomoc se stěhováním.
        Spousta z nás takhle s kamarády obchoduje už teď, a teď na to má místo i
        Linky. Klepněte na plus, zvolte <Term>Nabízím</Term> nebo{" "}
        <Term>Hledám</Term>, napište název, cenu a jednotku, třeba „za hodinu“
        nebo „za kg“, a přidejte.
      </Paragraph>
      <Paragraph>
        Cenu zadáváte v jednotce, kterou máte zapnutou, saty nevyjímaje, a
        klepnutím na jednotku vedle ceny ji přepnete. Kontakty vidí cenu ve své
        vlastní jednotce. Když je přepočtená z jiné měny, má před sebou vlnovku.
        Klepnutím na nabídku kontaktu se dostanete do chatu s ním.
      </Paragraph>
      <FigureRow>
        <DemoFigure
          screen="cash-intent"
          caption="Dave potřebuje hotovost na cestu. Zvolí, že ji poptává, a vidí, že Tomas a Lena ji nabízejí."
        />
        <DemoFigure
          screen="listings"
          caption="Dave projde, co jeho kontakty nabízejí a hledají, a pak nabídne opravu kol za 10 000 sat na hodinu."
        />
      </FigureRow>

      <Heading>Jen mezi těmi, kdo si uložili jeden druhého</Heading>
      <Paragraph>
        Vaše volba u hotovosti i vaše nabídky se dostanou jen ke kontaktům,
        které si uložily i vás. Linky je zveřejňuje na Nostru zašifrované tak,
        aby je otevřely jen vaše kontakty. Cizí člověk, který zná váš npub,
        nepřečte nic, a žádný veřejný katalog neexistuje: každý vidí jen to, co
        nabízejí jeho vlastní kontakty.
      </Paragraph>

      <Heading>Skener je vždycky vpravo nahoře</Heading>
      <Paragraph>
        Každá hlavní záložka má teď skener ve stejném pravém horním rohu. V
        Profilu a Kontaktech načte QR kód kontaktu, v Peněžence, Spolupráci a
        Nastavení i platby. Co tam bylo dřív, se přesunulo doleva: tužka v
        Profilu, hledání v Kontaktech a nedokončené on-chain převody v
        Peněžence.
      </Paragraph>

      <Heading>Dál v této verzi</Heading>
      <BulletList
        items={[
          <>
            Odeslání z peněženky s dlouhou historií je zase rychlé. Odeslaná
            platba se ukáže hned, bez čekání na účetnictví kolem ní.
          </>,
        ]}
      />

      <Heading>Chcete novinky dřív? Zkuste nightly</Heading>
      <Paragraph>
        Pokud nechcete čekat na release, používejte nightly na{" "}
        <TextLink href="https://nightly.app.linky.fit">
          nightly.app.linky.fit
        </TextLink>
        . Nasazuje se tam každá změna, kterou sloučíme do mainu, a běží na
        stejných produkčních relayích, mintech a sync serverech jako release.
        Všechno z tohoto článku tam běželo jako první.
      </Paragraph>
      <Paragraph>
        Počítejte s tím, že občas něco drhne. Když na to narazíte, dejte nám
        vědět.
      </Paragraph>
    </>
  );
}
