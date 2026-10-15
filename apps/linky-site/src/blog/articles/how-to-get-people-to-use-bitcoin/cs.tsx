import { BulletList, TextLink, VideoEmbed } from "@linky-fit/ui";
import { Figure, Heading, Paragraph } from "../../prose";
import { proxyPaymentsVideo, pubPhoto, walletPhoto } from "./media";

export function Body() {
  return (
    <>
      <Paragraph>
        Mnoho let se snažím přijít na to, jak dostat bitcoin mezi lidi. Ani
        dlouholetí bitcoineři často nechtějí platit bitcoinem. V lepším případě
        si ho pomalu hromadí a vlastně jim nic moc nechybí. Nakupují na burzách
        s poplatky a vystavují své osobní údaje. Ke každé transakci potřebují
        požehnání třetí strany.
      </Paragraph>
      <Paragraph>
        Občas slýchám, že bitcoin nikoho nepotřebuje a že naopak my potřebujeme
        bitcoin. Já to ale vnímám trochu jinak. Bitcoin je pro mě něco jako živý
        organismus. Jeho vznik považuji za podobně vzácnou událost, jako je
        samotný vznik života. Aby ale bitcoin skutečně žil a sloužil nám jako
        lepší peníze, potřebuje podle mě uživatele.
      </Paragraph>
      <Paragraph>
        S každou transakcí vzniká nová vazba nebo se posiluje ta stávající.
        Uživatelé se postupně zlepšují v zabezpečení bitcoinu, poptávají
        vylepšení nástrojů a bitcoin se stává odolnějším.
      </Paragraph>
      <Paragraph>
        Proto si myslím, že adopce není nějaký bonus navíc. Adopce je základní
        podmínkou, aby bitcoin skutečně sloužil.
      </Paragraph>

      <Heading>Zkoušel jsem různé cesty</Heading>
      <Paragraph>
        Líbila se mi například myšlenka{" "}
        <TextLink href="https://stacker.news/items/85702">
          dostat bitcoin přímo do Signalu
        </TextLink>
        . Signal ale podporu bitcoinu stále nepřidal a obávám se, že k tomu ani
        v dohledné době nebude mít dostatečný důvod.
      </Paragraph>
      <Paragraph>
        Před lety jsem také vytvořil{" "}
        <TextLink href="https://stacker.news/items/117623">
          aplikaci, která umožňovala nahrát bitcoin na NFC kartu
        </TextLink>{" "}
        a předávat ji podobně jako hotovost. Technicky to fungovalo. Ale nebyl o
        to dostatečný zájem. Byl to hezký projekt, jenže lidem neřešil žádný
        skutečný problém.
      </Paragraph>
      <Paragraph>
        Později jsem zkoumal i to,{" "}
        <TextLink href="https://stacker.news/items/210830">
          proč bitcoinem často nechtějí platit ani samotní bitcoineři
        </TextLink>
        .
      </Paragraph>

      <Heading>Nestačí umožnit obchodníkovi přijímat bitcoin</Heading>
      <Paragraph>
        Mezitím jsem lokálně onboardoval vyšší desítky podniků a bitcoinerů.
      </Paragraph>
      <Paragraph>
        Většinou to ale byly jen jednotlivé body na mapě. Podnik začal přijímat
        bitcoin, ale nikdo v něm bitcoinem neplatil. Obchodník po čase zapomněl,
        jak platbu přijmout nebo co s přijatým bitcoinem dělat.
      </Paragraph>
      <Paragraph>
        Až před rokem se mi podařilo tento problém částečně prolomit.
        Onboardoval jsem{" "}
        <TextLink href="https://stacker.news/items/1584550">
          jeden další podnik
        </TextLink>{" "}
        jednoduše proto, že jsem tam pravidelně chodil. A dodnes tam každý týden
        přijdeme v proměnlivé skupině lidí, kde ale všichni platí bitcoinem.
      </Paragraph>
      <Figure
        {...pubPhoto}
        alt="Hostinský ze Zlatého Selete s řízkem a pivem"
      />
      <Paragraph>
        Hostinský bitcoin původně vůbec nechtěl. Zajímaví jsme pro něj my jako
        zákazníci, kteří díky bitcoinu chodí právě k němu. Obchodník přijme ve
        výsledku jakoukoliv formu platby. Důležitější je najít lidi, kteří jsou
        ochotní bitcoinem platit. Zde to používáme jako filtr zajímavých lidí.
        Každý, kdo je ochotný platit bitcoinem, má svým způsobem otevřenou mysl
        a je radost se s ním na pravidelném obědě poznat.
      </Paragraph>

      <Heading>Nechci znovu záviset na jedné aplikaci</Heading>
      <Paragraph>
        V průběhu let jsem lidem doporučoval různé peněženky a nástroje. Některé
        z nich ale postupně skončily.
      </Paragraph>
      <Paragraph>
        V Česku přestala fungovat custodial verze Wallet of Satoshi, která byla
        nejvíce oblíbená. Alza jako největší obchodník v Čechách, který zároveň
        mezi prvními začal přijímat bitcoin, začala při platbě bitcoinem
        vyžadovat další administrativu. Qerko, které umožňovalo přijímat bitcoin
        cca v 1000 podnicích, podporu bitcoinu odstranilo.
      </Paragraph>
      <Paragraph>
        Nejdřív mě to celkem srazilo. Bylo to koncem roku 2025 a ve stejné době
        výrazně klesla i cena bitcoinu. A já musel řešit, co udělám s desítkami
        lidí, kterým jsem ukázal nějakou aplikaci a nyní jim nebude fungovat.
        Cítil jsem se trochu v pasti. U každé aplikace hrozilo, že takový přesun
        budu muset kdykoliv zase opakovat.
      </Paragraph>
      <Paragraph>
        Bitcoin přece nemá být závislý na tom, jestli jedna firma bude ochotná
        provozovat konkrétní aplikaci. V lednu 2026 mi ale také přišlo, že se
        výrazně zlepšily AI modely, a tak jsem zkusil vytvořit vlastní
        peněženku. Takovou, kterou jsem nosil v hlavě roky.
      </Paragraph>

      <Heading>Linky</Heading>
      <Figure {...walletPhoto} alt="Peněženka Linky na telefonu" />
      <Paragraph>
        <TextLink href="https://linky.fit/">Linky</TextLink> je bitcoinová
        peněženka a zároveň komunikační vrstva pro lidi, mezi kterými chcete
        bitcoin používat. Můžete si v ní přidat své kontakty, posílat jim zprávy
        i bitcoin. Zaplatíte jakoukoliv lightning fakturu. Bitcoin ve formě
        Cashu tokenu můžete nahrát na NFC kartu nebo ho poslat někomu ve zprávě
        – a to i člověku, který Linky vůbec nepoužívá.
      </Paragraph>
      <Paragraph>
        Snažím se ale také o určitou antifragilitu. Linky stavím od začátku tak,
        aby aplikace nebyla závislá na konkrétním provozovateli. Už dnes
        existují její další instance na jiných doménách. Kdyby moje instance
        zítra přestala fungovat, síť tím nemusí skončit.
      </Paragraph>
      <Paragraph>
        Pomáhá nám v tom kombinace tří decentralizovaných technologií:
      </Paragraph>
      <BulletList
        items={[
          "Cashu pro bitcoin,",
          "Nostr pro komunikaci,",
          "Evolu pro uchování dat.",
        ]}
      />
      <Paragraph>
        Používáme i další zajímavé technologie, ale nechci teď zabíhat do
        technických detailů.
      </Paragraph>
      <Paragraph>
        Na Linky se dnes podílí dalších šest vývojářů. Jeden z nich je můj
        kamarád David Novák, který aplikaci vylepšuje velmi intenzivně –
        primárně po technické stránce. Ze srandovní vibecodované aplikace se
        postupně stává seriózní projekt. V lokální skupině Linky testuje zhruba
        250 lidí a používá ji i nižší stovky dalších uživatelů.
      </Paragraph>

      <Heading>Jednotlivci</Heading>
      <Paragraph>
        Lidé Linky používají, protože se jim líbí. Pro svoji jednoduchost a
        zároveň rostoucí spolehlivost se pro mnoho lidí postupně stává hlavní
        bitcoinovou peněženkou.
      </Paragraph>
      <Paragraph>
        Nicméně většina lidí pořád žádnou lightning peněženku nepotřebuje.
      </Paragraph>
      <Paragraph>
        Můžete vytvořit skvělou peněženku. Můžete onboardovat obchodníky. Můžete
        vysvětlovat lidem výhody bitcoinu. Ale pokud nemají důvod bitcoin
        používat, budou to pořád jen záblesky.
      </Paragraph>

      <Heading>Proxy platby</Heading>
      <Paragraph>
        Nedávno se nám ale podařilo vytvořit funkci, která podle mě může tenhle
        problém alespoň částečně řešit. Říkáme jí proxy platby.
      </Paragraph>
      <Paragraph>
        V Česku lidé stále častěji používají QR kódy pro bankovní převody.
        Najdete je v e-shopech i ve fyzických obchodech. Pro uživatele je to
        zatím trochu méně pohodlné než placení kartou, ale obchodník je moc rád,
        že nemusí platit poplatky karetním společnostem.
      </Paragraph>
      <Paragraph>
        Bitcoinem dnes můžu zaplatit ve kterémkoliv z takových obchodů. Bez
        poplatků a bez KYC. Naskenuji platební QR kód pomocí Linky – stejně jako
        kdybych chtěl platit lightning fakturu. Linky nabídne platbu mým
        kontaktům. Vyberu několik přátel a odešlu jim nabídku.
      </Paragraph>
      <Paragraph>
        Kdo ji první přijme, dostane platební údaje z QR kódu. Zaplatí podniku
        ze svého bankovního účtu a já mu za to pošlu saty.
      </Paragraph>
      <VideoEmbed src={proxyPaymentsVideo} title="Proxy platby v Linky" />

      <Heading>Tolik práce, přitom taková…</Heading>
      <Paragraph>
        Možná to zní jako zbytečná oklika. Proč bych měl někoho žádat, aby za mě
        zaplatil bankovním převodem, když to můžu prostě zaplatit sám?
      </Paragraph>
      <Paragraph>
        Pro mě je to užitečné, protože nemusím držet fiat, který ztrácí hodnotu.
        Pro mé přátele je to užitečné, protože nemusí používat burzu, platit
        poplatky a vystavovat svoje osobní údaje. Získají bitcoin interaktivním
        způsobem – obvykle po malých částkách. Jako vedlejší bonus pro všechny
        je ten abstraktní fakt, že budujete bitcoinovou síť a tím si zajišťujete
        možnost použití bitcoinu i v budoucnu.
      </Paragraph>
      <Paragraph>
        Pro pohodlné používání proxy platby vám stačí odhadem dva nebo tři lidi.
        Většina plateb je vyřešená do dvou minut. Není to tak přímé a rychlé
        jako platba kartou, ale slouží to velmi dobře.
      </Paragraph>
      <Paragraph>
        Linky ukazuje lidem nové možnosti, jak bitcoin používat. Vyzkoušejte ji
        na <TextLink href="https://linky.fit/">linky.fit</TextLink> a pojďte nám
        pomoct s testováním a budováním naší společné bitcoinové sítě. 🙏
      </Paragraph>
    </>
  );
}
