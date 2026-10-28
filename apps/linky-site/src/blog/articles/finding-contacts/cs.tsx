import { BulletList } from "@linky-fit/ui";
import {
  AsideFigure,
  DemoFigure,
  FigureRow,
  Heading,
  Paragraph,
  ScreenshotFigure,
  Term,
} from "../../prose";
import { shots } from "./media";

export function Body() {
  return (
    <>
      <Paragraph>
        Když si nainstalujete WhatsApp nebo Signal, máte během pár vteřin
        desítky kontaktů na základě vašich telefonních čísel. Linky tohle
        záměrně neumí. Nechceme znát vaše telefonní číslo, e-mail ani žádný
        doklad. Účet na Linky vzniká z klíčů, které si telefon vygeneruje sám.
      </Paragraph>
      <Paragraph>
        Má to jednu dost nepříjemnou nevýhodu. Po instalaci máte v Kontaktech
        prázdno a aplikace neví, koho ve skutečnosti znáte. Proto se v Linky
        hodně soustředíme na to, aby bylo co nejjednodušší najít člověka, který
        stojí vedle vás nebo se kterým si píšete jinde. Tady je přehled všech
        způsobů, které dnes v Linky fungují.
      </Paragraph>

      <Heading>1. QR kód</Heading>
      <Paragraph>
        Klasika, která funguje na každém telefonu i na webu. Každý uživatel
        Linky má v záložce Profil svůj QR kód. Druhý člověk v Kontaktech klepne
        na tlačítko s panáčkem a plusem, pak na <Term>Načíst QR kontaktu</Term>{" "}
        a namíří kameru. Nebo naopak: vy naskenujete jeho.
      </Paragraph>
      <Paragraph>
        Když u sebe nejste, pošlete místo QR kódu odkaz. Tlačítko{" "}
        <Term>Sdílet profil</Term> vytvoří adresu linky.fit/p/…, kterou pošlete
        v jakémkoli messengeru. Kdo ji otevře, uvidí vaše jméno a avatar a
        tlačítkem <Term>Otevřít v Linky</Term> si vás přidá.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.profile}
          alt="Záložka Profil s avatarem, jménem, QR kódem a tlačítkem Sdílet profil"
          caption="QR kód v záložce Profil. Stačí ho ukázat, druhá strana ho naskenuje."
        />
        <DemoFigure
          screen="profile-open"
          caption="Mia dostane odkaz na profil, klepne na Otevřít v Linky a má Davea v kontaktech."
        />
      </FigureRow>

      <Heading>2. Noví uživatelé</Heading>
      <AsideFigure
        shot={shots.contactNew}
        alt="Stránka Přidat kontakt s tlačítkem Načíst QR kontaktu, vyhledávacím polem a dvěma novými uživateli v Návrzích"
        caption="Návrhy dole na stránce Přidat kontakt: noví uživatelé Linky z poslední hodiny."
      >
        <Paragraph>
          Nejčastější situace, se kterou se potkáváme: kamarád si vedle vás
          právě nainstaloval Linky a vy mu chcete poslat první saty. Proto dole
          na stránce <Term>Přidat kontakt</Term> ukazujeme v návrzích účty,
          které vznikly v poslední hodině, se štítkem <Term>Nový</Term>.
          Zpravidla je mezi nimi právě ten kamarád. Klepnete na něj a je to.
        </Paragraph>
        <Paragraph>
          Pozor na to, že jméno a avatar si každý vybírá sám. Než novému
          kontaktu něco pošlete, ujistěte se, že je to opravdu ten, za koho ho
          máte. Přidávejte si jen lidi, které osobně znáte.
        </Paragraph>
      </AsideFigure>

      <Heading>3. Vyhledání podle registrovaného jména</Heading>
      <Paragraph>
        Na stránce <Term>Přidat kontakt</Term> je pod tlačítkem pro QR kód
        vyhledávací pole. Nejspolehlivější je hledat podle Linky jména, které si
        člověk zaregistroval. Když si Alice v profilu rezervovala adresu
        alice@linky.fit, stačí napsat „alice“ a Linky ji najde. Jméno se
        registruje v záložce Profil přes tužku a <Term>Rezervovat adresu</Term>{" "}
        a platí se saty z peněženky. Stejně funguje i ověřené jméno z jiné
        aplikace na síti Nostr ve tvaru jmeno@domena.cz.
      </Paragraph>
      <Paragraph>Do stejného pole můžete vložit i:</Paragraph>
      <BulletList
        items={[
          <>
            <b>Jméno nebo přezdívku.</b> Linky prohledá profily na síti Nostr,
            na které běží. Často najde víc lidí stejného jména, toho správného
            poznáte podle avataru, a když ne, zeptejte se.
          </>,
          <>
            <b>npub</b>, dlouhý řetězec začínající na npub1. Je to veřejný
            identifikátor účtu, který vám druhý může poslat. Ikona vpravo ho
            vloží ze schránky.
          </>,
          <>
            <b>Lightning adresu</b> někoho, kdo Linky nemá. Psát si nebudete,
            ale peníze mu posílat můžete.
          </>,
        ]}
      />
      <ScreenshotFigure
        shot={shots.contactSearch}
        alt="Stránka Přidat kontakt s výsledky hledání jména hynek, první výsledek má adresu hynek@linky.fit"
        caption="Hledání podle jména. Registrované Linky jméno je v seznamu první."
      />

      <Heading>4. Lidé v okolí</Heading>
      <Paragraph>
        <Term>Maják</Term> je funkce pro situace, kdy je v místnosti víc lidí s
        Linky, třeba na meetupu. Telefon přes Bluetooth vysílá, že jste poblíž,
        a zároveň poslouchá ostatní. Dokud máte Linky otevřené, uvidí váš npub
        každý, kdo v okolí hledá, a může si vás přidat. Na stránce{" "}
        <Term>Přidat kontakt</Term> se takoví lidé objeví v návrzích se štítkem{" "}
        <Term>V okolí</Term>.
      </Paragraph>
      <Paragraph>
        Kontakty, které si vás už uložily a vy je, vidí navíc, když jste poblíž.
        K majáku můžete připojit i záměr <Term>Koupí BTC</Term> nebo{" "}
        <Term>Prodá BTC</Term>. Kdo chce na meetupu koupit saty za hotovost,
        hned vidí, kdo z jeho známých prodává.
      </Paragraph>
      <Paragraph>
        Maják zapnete v záložce <Term>Proxy platby</Term> v sekci{" "}
        <Term>V okolí</Term>. Zatím je to experimentální funkce v aplikaci pro
        Android, takže ji nejdřív musíte povolit v <Term>Nastavení</Term> v
        sekci <Term>Debug</Term>. Potřebuje Bluetooth a dokud běží, ukazuje
        notifikaci, abyste věděli, že vysíláte.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.contactsNearby}
          alt="Záložka Kontakty se sekcí V okolí, ve které jsou avatary Vy, Mia se štítkem Prodá BTC, Dave a Ben"
          caption="Kontakty v okolí nahoře v záložce Kontakty. Mia dala vědět, že prodává bitcoin."
        />
        <ScreenshotFigure
          shot={shots.beacon}
          alt="Záložka Proxy platby se zapnutým majákem, který vysílá třem kontaktům, a volbou Prodá BTC"
          caption="Maják v záložce Proxy platby: přepínač, stav vysílání a volba, co chcete obchodovat."
        />
      </FigureRow>

      <Heading>5. Sdílení kontaktů a skupin ve zprávě</Heading>
      <AsideFigure
        shot={shots.chatContacts}
        alt="Konverzace s Miou, která poslala skupinu Lezci se třemi kontakty a tlačítkem Přidat všechny"
        caption="Mia poslala celou skupinu Lezci. Tlačítko Přidat všechny uloží tři kontakty najednou."
        side="left"
      >
        <Paragraph>
          Jakmile pár kontaktů máte, nejpřirozenější cesta k dalším vede přes
          ně. V konverzaci napište <Term>@</Term> a začněte psát jméno. Linky
          nabídne vaše kontakty a vložený kontakt se v odeslané zprávě ukáže
          jako štítek s avatarem. Příjemce na něj klepne a uloží si ho.
        </Paragraph>
        <Paragraph>
          Totéž funguje pro celé skupiny. Když máte kontakty roztříděné do
          skupin, třeba Lezci nebo Rodina, napíšete <Term>@Lezci</Term> a do
          zprávy se vloží všichni najednou. Druhá strana má u zprávy tlačítko{" "}
          <Term>Přidat všechny</Term> a hned potom si může všechny nové kontakty
          zařadit do vlastní skupiny. Jeden člověk tak může zbytku party ušetřit
          skenování šesti QR kódů.
        </Paragraph>
      </AsideFigure>

      <Heading>6. NFC karta</Heading>
      <Paragraph>
        Alternativní způsob, jak někomu předat svůj kontakt, je přiložit kartu k
        jeho telefonu. V záložce Profil je v aplikaci pro Android tlačítko{" "}
        <Term>Nahrát na tag</Term>. Na libovolný NFC tag nebo kartu zapíše váš
        veřejný identifikátor, takzvaný npub. Kdo pak kartu přiloží k telefonu s
        Linky, otevře se mu váš profil a jedním klepnutím si vás uloží. Nic
        nemusí skenovat ani psát.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.profileNfc}
          alt="Záložka Profil s QR kódem a tlačítky Sdílet profil a Nahrát na tag"
          caption="Tlačítko Nahrát na tag v záložce Profil zapíše váš npub na NFC kartu."
        />
        <ScreenshotFigure
          shot={shots.nfcModal}
          alt="Dialog Připraveno ke skenování s výzvou Přiložte NFC tag"
          caption="Po klepnutí stačí přiložit tag k zadní straně telefonu."
        />
      </FigureRow>
      <Paragraph>
        Prázdné NFC tagy stojí pár korun a karta s Linky se vejde do peněženky
        vedle platební. Na meetupu ji podáte přes stůl, v obchodě ji přiložíte k
        pokladně. Stejným způsobem jde na tag nahrát i saty, ale to je na jiný
        článek.
      </Paragraph>

      <Heading>Nepotřebujete stovky kontaktů</Heading>
      <Paragraph>
        Prázdný seznam na začátku vypadá jako nevýhoda, ale má i druhou stranu.
        V Linky nemáte stovky lidí, se kterými jste si před deseti lety vyměnili
        číslo. Máte v něm jen ty, které jste si přidali sami a které opravdu
        znáte. Pro peněženku je to vlastně přesně to, co chcete. Platíte lidem,
        kterým věříte, a oni vám.
      </Paragraph>
      <Paragraph>
        Stačí pár kontaktů. Kamarád, se kterým si posíláte peníze za oběd, někdo
        z rodiny a jeden dva lidi, kteří vám prodají saty za hotovost. Síť pak
        roste sama: každý nový kontakt vám může ve zprávě poslat své kontakty a
        skupiny. A nebojte se mazat kontakty, které jste si přidali nahodile a u
        kterých si už nepamatujete, o koho přesně jde. Když vám takový člověk
        znovu napíše, kontakt se i s historií vrátí sám.
      </Paragraph>
      <Paragraph>
        A pokud zatím nikoho s Linky neznáte, zajděte na nejbližší bitcoinový
        meetup nebo konferenci. Tam je NFC karet, QR kódů a zapnutých majáků
        nejvíc a první kontakty si odnesete během jednoho večera. Linky je
        nakonec hlavně o lidech, bitcoin je jen způsob, jak si mezi nimi posílat
        hodnotu.
      </Paragraph>
    </>
  );
}
