import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, FigureRow, Heading, Paragraph, Term } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Vyšel Linky 26.11.5. Aplikace i web teď mluví slovensky, on-chain
        převody běží non-stop a platby z dlouho používaných peněženek jsou
        zhruba dvakrát rychlejší.
      </Paragraph>

      <Heading>Linky mluví slovensky</Heading>
      <Paragraph>
        Kdo doteď otevřel Linky na slovenském telefonu, dostal angličtinu. Od
        verze 26.11.5 mluví slovensky celá aplikace i web linky.fit. Slovenský
        prohlížeč si ji vybere sám, nebo ji přepnete v <Term>Nastavení</Term>{" "}
        pod položkou <Term>Jazyk</Term> volbou <Term>Slovenčina</Term>.
      </Paragraph>
      <Paragraph>
        Nové účty ve slovenštině začínají s eury, formátují data i čísla po
        slovensku a umí hledat emoji podle slovenských slov v reakcích i ve
        zprávách po dvojtečce.
      </Paragraph>

      <Heading>On-chain převody běží non-stop</Heading>
      <Paragraph>
        Bitcoin mezi Linky a klasickou on-chain peněženkou přesunete přes{" "}
        <Term>Odeslat do on-chain peněženky</Term> a{" "}
        <Term>Přijmout z on-chain peněženky</Term>. Doteď byla služba občas
        nedostupná, takže se nikdo nemůže divit, když jste na ni zapomněli. Teď
        už má běžet non-stop. Pokud chcete přesunout saty na hardwarovou
        peněženku nebo naopak poslat bitcoin z on-chain peněženky do Linky,
        klidně to vyzkoušejte.
      </Paragraph>
      <Paragraph>
        Odeslání na on-chain se navíc líp sleduje. Na obrazovce převodu teď
        vidíte svou cílovou adresu a tlačítko{" "}
        <Term>Otevřít adresu v prohlížeči</Term>, které ji otevře v prohlížeči
        blockchainu. Když platba dorazí na on-chain, otevření odkazu transakci
        zkontroluje a rovnou označí převod jako hotový.
      </Paragraph>
      <FigureRow>
        <DemoFigure
          screen="slovak-language"
          caption="Přepnutí Jazyka na Slovenčina přeloží celou aplikaci a zobrazí zůstatek v eurech."
        />
        <DemoFigure
          screen="onchain-send"
          caption="Dave pošle 100 000 sat do on-chain peněženky, otevře cílovou adresu v prohlížeči a převod se označí jako hotový."
        />
      </FigureRow>

      <Heading>Rychlejší platby a plynulejší synchronizace</Heading>
      <Paragraph>
        Když Linky používáte pár měsíců, v peněžence se nastřádají stovky
        drobných kousků ecash. Platby z takové peněženky jsou teď zhruba dvakrát
        rychlejší než dřív.
      </Paragraph>
      <Paragraph>
        Plynulejší je i synchronizace mezi zařízeními. Zprávy, kontakty, nabídky
        i historie plateb se mezi telefonem a počítačem drží v souladu bez
        jediného přepínače navíc. Stávající data se při prvním otevření verze
        26.11.5 převedou sama. Pokud máte Linky na více zařízeních, aktualizujte
        prosím všechna, aby spolu zůstala v synchronizaci.
      </Paragraph>

      <Heading>Další opravy v této verzi</Heading>
      <BulletList
        items={[
          <>
            Čekající Lightning platba se ukáže jako zaplacená během pár sekund
            po vypořádání, bez restartu aplikace.
          </>,
          <>
            Přijaté tokeny se rovnou hlásí jako přijaté místo toho, aby
            problikly jako neplatné.
          </>,
          <>Rychle za sebou poslané zprávy drží pořadí, v jakém odešly.</>,
          <>
            Historie plateb ukazuje u Lightning plateb celý poplatek a žádost o
            platbu označí jako zaplacenou hned, jak dorazí celá částka.
          </>,
          <>
            Hledání kontaktu podle ověřené adresy schová falešné profily, které
            si tu samou adresu jen přivlastňují.
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
