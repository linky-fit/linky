import { BulletList, TextLink } from "@linky-fit/ui";
import {
  DemoFigure,
  Heading,
  Paragraph,
  ScreenshotFigure,
  Subheading,
} from "../../prose";
import { shots } from "./media";

export function Body() {
  return (
    <>
      <Paragraph>
        V tomto návodu nejsou popsány všechny funkce Linky a ani u těch
        popsaných nenajdete všechny možnosti. Je psán stylem „jak udělám tohle“
        a „jak mám udělat tamto“, abyste mohli Linky začít používat co nejdříve
        a co nejsnáze. Až budete chtít složitější funkce a nastavení, patrně už
        budete na takové úrovni, že k tomu žádný návod nepotřebujete.
      </Paragraph>

      <Heading>1. Instalace</Heading>
      <Subheading>Android</Subheading>
      <Paragraph>
        Linky si stáhnete z{" "}
        <TextLink href="https://play.google.com/store/apps/details?id=fit.linky.app">
          Google Play
        </TextLink>
        . Při hledání zadejte „Linky.fit“, samotné slovo Linky najde i jiné
        aplikace. Kdo používá Zapstore, najde Linky i tam. Po instalaci přejděte
        na část 2, Vytvoření účtu.
      </Paragraph>
      <Subheading>iPhone</Subheading>
      <Paragraph>
        V App Store Linky zatím není. Na iPhonu ji uložíte a spouštíte jako
        webovou aplikaci (PWA). V Safari otevřete{" "}
        <TextLink href="https://app.linky.fit">app.linky.fit</TextLink>,
        klepnete na tlačítko Sdílet, v nabídce vyberete Přidat na plochu a
        potvrdíte tlačítkem Přidat. Na ploše se objeví ikona Linky a aplikace se
        pak chová jako každá jiná.
      </Paragraph>
      <Paragraph>
        Stejná adresa app.linky.fit funguje i v prohlížeči na počítači. Účet je
        jeden, telefon i počítač ho mohou používat zároveň.
      </Paragraph>

      <Heading>2. Vytvoření účtu</Heading>
      <Paragraph>
        Nikam nemusíte zadávat telefonní číslo ani e-mail. Spustíte Linky a
        klepnete na Vytvořit profil. Zadáte jméno, pod kterým chcete v Linky
        vystupovat, a klepnete na Pokračovat. Na další stránce „Jak tě uvidí
        ostatní?“ už máte vygenerovaný avatar. Můžete si ho vyměnit tlačítkem
        Nový avatar, Nahrát fotku nebo se rovnou Vyfotit. Všechno se dá změnit i
        později v záložce Profil, takže klidně klepněte na Potvrdit profil.
        Linky se otevře v záložce Kontakty.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.welcome}
        alt="Úvodní obrazovka Linky s tlačítky Vytvořit profil a Už mám profil"
        caption="Úvodní obrazovka. Nový účet založíte tlačítkem Vytvořit profil, existující obnovíte přes Už mám profil."
      />
      <ScreenshotFigure
        shot={shots.picture}
        alt="Stránka Jak tě uvidí ostatní s avatarem a tlačítky Nahrát fotku, Vyfotit se a Nový avatar"
        caption="Avatar máte vygenerovaný hned. Fotku můžete nahrát teď, nebo kdykoli později."
      />
      <Paragraph>
        Tlačítko Už mám profil slouží k obnovení účtu z klíčů. K tomu se
        dostaneme v části 2.2.
      </Paragraph>

      <Subheading>2.1 Úvodní checklist</Subheading>
      <Paragraph>
        Nahoře na stránce Kontakty se zobrazuje checklist Začínáme s vaším
        skóre, třeba Splněno 1/8, a dalším úkolem, který je na řadě. Linky
        můžete používat hned, úkoly vás jen provedou základními funkcemi.
        Tlačítko Ukázat vás krok za krokem dovede na správné místo v aplikaci.
        Prvních pět úkolů jsou základy:
      </Paragraph>
      <BulletList
        items={[
          "Přidat kontakt",
          "Poslat zprávu",
          "Přijmout bitcoin",
          "Zálohovat klíče",
          "Zaplatit",
        ]}
      />
      <Paragraph>
        Zbylé tři, registrace vlastního Linky jména, skupiny kontaktů a
        nastavení proxy plateb, počkají, až se rozkoukáte. V aplikaci pro
        Android je ještě devátý úkol, zapnutí majáku, díky kterému vás uvidí
        kontakty v okolí.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.checklist}
        alt="Záložka Kontakty s checklistem Začínáme, skóre 1/8 a úkolem Poslat zprávu"
        caption="Checklist Začínáme na stránce Kontakty ukazuje úkol, který je na řadě."
      />
      <Paragraph>
        Checklist můžete skrýt křížkem vpravo nahoře. Skrytí se uloží do vašeho
        účtu, takže se už neobjeví ani po novém spuštění, ani na jiném zařízení.
        Celý seznam úkolů najdete kdykoli v Nastavení pod položkou Tutoriál a
        každý z nich si tam můžete nechat znovu ukázat.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.tutorial}
        alt="Stránka Tutoriál v Nastavení se seznamem osmi úkolů a tlačítky Ukázat"
        caption="Tutoriál v Nastavení: všechny úkoly pohromadě, každý s tlačítkem Ukázat."
      />
      <Paragraph>
        Nejdůležitější úkol je zálohování klíčů, proto je tu hned další část.
      </Paragraph>

      <Subheading>2.2 Klíče a jejich záloha</Subheading>
      <Paragraph>
        Klíče Linky vytvořila sama při založení profilu, nic generovat nemusíte.
        Potřebujete je ve třech situacích: když přenášíte profil na jiný
        telefon, když současný telefon přestane fungovat, ztratíte ho nebo vám
        ho někdo ukradne, a když v Nastavení použijete Odhlásit se. Odhlášení
        smaže data Linky z telefonu a bez klíčů se k účtu, a tedy i k penězům,
        nedostanete. Pokud se neodhlásíte, Linky spouštíte jen klepnutím na její
        ikonu.
      </Paragraph>
      <Paragraph>
        Klíče najdete v Nastavení, v sekci Zabezpečení pod položkou Hlavní
        klíče. Je to 20 slov. Tlačítkem Zobrazit si je ukážete, Kopírovat je
        dáte do schránky a Uložit do hesel je předáte správci hesel v telefonu,
        pokud ho máte.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.masterKeys}
        alt="Stránka Hlavní klíče s dvaceti skrytými slovy a tlačítky Kopírovat, Zobrazit a Uložit do hesel"
        caption="Hlavní klíče v Nastavení. Dokud neklepnete na Zobrazit, zůstávají slova skrytá."
      />
      <Paragraph>
        Při obnově na jiném zařízení klepnete na Už mám profil. Buď slova
        vložíte najednou tlačítkem Vložit ze schránky, nebo je vypíšete do
        dvaceti políček jedno po druhém, Linky každé zkontroluje. Třetí a čtvrté
        slovo je v záloze Linky vždy „academic“, není to překlep. Stejným
        postupem si Linky otevřete na druhém zařízení, třeba na počítači, a obě
        zařízení pak běží současně.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.restore}
        alt="Stránka Vítej zpět s tlačítkem Vložit ze schránky a políčky pro 20 slov"
        caption="Obnova účtu: slova vložíte ze schránky, nebo je vypíšete po jednom."
      />
      <Paragraph>
        U hardwarové peněženky si klíče (seed) nesmíte uložit elektronicky, jako
        text nebo fotku, aby je nikdo nepovolaný nemohl zjistit. V Linky jsou
        klíče vygenerované v telefonu, takže když si je uložíte elektronicky,
        třeba do správce hesel, už to tím moc nezhoršíte. Hlavně je nenechávejte
        jenom v telefonu, který teď používáte. Při jeho poškození nebo ztrátě
        byste o možnost obnovy přišli. Doporučujeme si klíče i opsat na papír a
        uložit, nebo použít jinou, odolnější zálohu.
      </Paragraph>
      <Paragraph>
        Linky nemá sloužit k uložení velkých částek, na to jsou hardwarové
        peněženky. Do Linky vkládejte jen menší množství peněz, pár tisíc,
        tolik, kolik jste byli zvyklí nosit v peněžence. Když víte, že budete
        kupovat něco dražšího nebo jedete na akci, kde budete platit bitcoinem,
        nabijte si Linky vyšší částkou. Proto tolik nevadí, že klíče máte
        uložené elektronicky. Pokud by je někdo nepovolaný zjistil, nebude to
        fatální ztráta.
      </Paragraph>

      <Heading>3. Peněženka, kontakty a zprávy</Heading>
      <Paragraph>
        Linky je bitcoinová peněženka, ale svým kontaktům v ní posíláte i
        zprávy, fotky a PDF soubory. Dole na obrazovce je lišta se záložkami
        Profil (váš avatar), Kontakty, Peněženka, Proxy platby a Nastavení.
        Linky se otevírá v záložce Kontakty. Proxy platby v tomto návodu
        přeskočíme, na začátek je nebudete potřebovat.
      </Paragraph>
      <Paragraph>
        I když je Linky peněženka, začneme kontakty, protože je budete používat
        i pro platby a pro dokončení úvodního checklistu.
      </Paragraph>

      <Subheading>3.1 Kontakty</Subheading>
      <Paragraph>
        V Kontaktech vidíte lidi, se kterými si v Linky píšete a platíte. Nejsou
        to kontakty s telefonními čísly z vašeho telefonu, ty Linky nečte. Koho
        chcete, toho si do Linky přidáte. U každého kontaktu je avatar, jméno,
        čas a náhled poslední zprávy. Klepnutím na kontakt otevřete vaši
        společnou konverzaci.
      </Paragraph>
      <DemoFigure
        screen="contacts"
        caption="Záložka Kontakty. Vpravo dole je tlačítko pro přidání kontaktu."
      />

      <Subheading>3.1.1 Jak si do Linky přidat kontakt</Subheading>
      <Paragraph>
        Vpravo dole je tlačítko s panáčkem a plusem. Otevře stránku Přidat
        kontakt. Nahoře je velké tlačítko Načíst QR kontaktu, pod ním
        vyhledávací pole a dole Návrhy: lidé v okolí a noví uživatelé Linky.
        Linky vám připomene, abyste si přidávali jen důvěryhodné kontakty, které
        osobně znáte.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactNew}
        alt="Stránka Přidat kontakt s tlačítkem Načíst QR kontaktu, vyhledávacím polem a návrhy"
        caption="Přidat kontakt. Nejrychlejší je naskenovat QR kód druhého člověka."
      />
      <Paragraph>
        Když stojíte vedle sebe, je nejrychlejší naskenovat QR kód. Druhý si
        otevře záložku Profil, kde má svůj QR kód, a vy klepnete na Načíst QR
        kontaktu. Nebo naopak: ukážete svůj profil a necháte se naskenovat.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.profile}
        alt="Záložka Profil s avatarem, jménem, QR kódem, tlačítkem Sdílet profil a Lightning adresou"
        caption="Záložka Profil. QR kód naskenuje druhá strana, odkaz pošlete tlačítkem Sdílet profil."
      />
      <Paragraph>
        Když u sebe nejste, začněte do vyhledávacího pole psát jméno nebo
        přezdívku. Linky hledá mezi lidmi, kteří mají Linky nebo jiného klienta
        sítě Nostr, na které Linky běží. Často najde víc lidí stejného jména.
        Když jsem zadal „Petr“, našlo jich šest. Správného Petra poznáte podle
        avataru, a když ne, zeptejte se ho. U správného jména klepnete na Přidat
        a kontakt se uloží. U někoho, koho už máte, je místo toho Otevřít.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactSearch}
        alt="Stránka Přidat kontakt s výsledky hledání jména Hynek a tlačítky Přidat"
        caption="Hledání podle jména. U nalezeného člověka klepnete na Přidat."
      />
      <Paragraph>Do stejného pole můžete místo jména vložit i:</Paragraph>
      <BulletList
        items={[
          <>
            <b>npub</b>, dlouhý řetězec začínající na npub1. Je to veřejný
            identifikátor účtu, něco jako číslo účtu, které vám druhý pošle.
            Ikona vpravo v poli ho vloží ze schránky.
          </>,
          <>
            <b>NIP-05</b>, ověřené jméno ve tvaru jmeno@domena.cz, pokud si ho
            druhý zařídil.
          </>,
          <>
            <b>Rezervované jméno</b>, tedy jméno, které si někdo zaregistroval
            na linky.fit. Stačí napsat třeba „alice“.
          </>,
          <>
            <b>Lightning adresu</b> člověka, který Linky nemá. Linky nabídne
            Uložit lightning adresu a vy mu pak můžete posílat peníze, i když si
            nebudete psát.
          </>,
        ]}
      />
      <Paragraph>
        Když Linky nic nenajde, nabídne tlačítko Vytvořit kontakt a údaje
        vyplníte ručně.
      </Paragraph>
      <Paragraph>
        Na dálku je nejpohodlnější odkaz na profil. Každý uživatel Linky má
        stránku linky.fit/p/… a pošle ji ze záložky Profil tlačítkem Sdílet
        profil. Kdo odkaz otevře, klepne na Otevřít v Linky a má vás v
        kontaktech i s rozepsaným pozdravem.
      </Paragraph>
      <DemoFigure
        screen="profile-open"
        caption="Mia otevře odkaz na profil, klepne na Otevřít v Linky a pozdraví Davea."
      />

      <Subheading>3.1.2 Údaje kontaktu, skupiny a mazání</Subheading>
      <Paragraph>
        Když v konverzaci klepnete vpravo nahoře na tužku, otevře se stránka
        Úprava kontaktu s poli Jméno, Identifikátor, Lightning adresa a Skupina.
        Jakmile něco změníte, objeví se dole tlačítko Uložit změny.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactEdit}
        alt="Stránka Úprava kontaktu s poli Jméno, Identifikátor, Lightning adresa a Skupina a ikonou koše vpravo nahoře"
        caption="Úprava kontaktu. Koš vpravo nahoře kontakt smaže."
      />
      <Paragraph>
        Jméno si upravte, jak chcete, Linky ho ukazuje jen vám. Identifikátor
        raději neměňte, je to npub, podle kterého Linky kontakt pozná. Lightning
        adresa je u uživatelů Linky ve tvaru npub…@linky.fit. Pokud si kontakt
        zaregistruje vlastní jméno, třeba pepa@linky.fit, uvidíte tuto adresu.
        Do pole Skupina napište třeba Rodina a potvrďte Enterem. Zapsáním nového
        jména skupina vznikne a v Kontaktech pak můžete podle skupin filtrovat.
        Klepnutím na existující skupinu do ní kontakt přidáte.
      </Paragraph>
      <Paragraph>
        Ikona koše vpravo nahoře kontakt smaže jedním klepnutím. Hned potom se
        dole objeví Vrátit zpět, kdybyste se spletli. A když vám smazaný člověk
        znovu napíše, kontakt se vrátí sám, takže o zprávu nepřijdete.
      </Paragraph>

      <Subheading>3.2 Zprávy</Subheading>
      <Paragraph>
        Když chcete někomu napsat, klepněte na jeho kontakt. Otevře se
        konverzace a dole je pole Zpráva. Vedle něj je tlačítko pro přílohu,
        kterým přidáte obrázek nebo PDF. Pozor, přílohu vyberte dřív, než
        začnete psát. Jakmile v poli něco je, tlačítko pro přílohu se změní na
        Odeslat. Obrázek může mít až 20 MB, PDF 2 MB.
      </Paragraph>
      <Paragraph>
        Když na zprávu klepnete, nabídne Linky řadu smajlíků pro reakci (plus
        otevře celý katalog emoji) a akce Odpovědět, Kopírovat a Smazat. U
        vlastní textové zprávy přibude Upravit. Smazání platí pro obě strany,
        místo zprávy zůstane u vás i u protistrany jen „Zpráva byla smazána“.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.messageActions}
        alt="Nabídka akcí zprávy s reakcemi a položkami Odpovědět, Upravit, Kopírovat a Smazat"
        caption="Klepnutí na zprávu: reakce, Odpovědět, Upravit, Kopírovat a Smazat."
      />

      <Subheading>3.2.1 Platby mezi vámi a kontaktem</Subheading>
      <Paragraph>
        Dole v konverzaci jsou tlačítka Požádat a Zaplatit. Ať v Linky vidíte
        koruny nebo jinou měnu, posílají se vždy saty, tedy zlomky bitcoinu.
        Částku ale můžete zadávat v korunách, třeba 500 Kč, a Linky ji přepočte.
        Klepáním na částku přepínáte mezi měnami. V prvotním nastavení jsou
        zapnuté Kč a saty, další měny si přidáte v Nastavení pod položkou
        Jednotky.
      </Paragraph>
      <Paragraph>
        Tlačítkem Požádat vyzvete kontakt, aby vám zaplatil. Na stránce Platba
        na kontakt naťukáte částku, případně přidáte popisek, a klepnete na
        Požádat. V konverzaci se objeví Žádost o platbu s částkou. Druhá strana
        ji jedním klepnutím zaplatí, nebo ji odmítne a u žádosti uvidíte
        Odmítnuto.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactRequest}
        alt="Stránka Platba na kontakt s částkou 500 Kč, číselnou klávesnicí a tlačítkem Požádat"
        caption="Žádost o platbu. Částku naťukáte na klávesnici a klepnete na Požádat."
      />
      <DemoFigure
        screen="chat-request"
        caption="Žádost o platbu v konverzaci. Druhá strana ji potvrdí jedním klepnutím."
      />
      <Paragraph>
        Tlačítkem Zaplatit kontaktu pošlete peníze. Na stejné stránce Platba na
        kontakt vidíte jméno příjemce, dostupnou částku a vedle jména malou
        ikonu. Fazole znamená Cashu, blesk Lightning, klepnutím mezi nimi
        přepínáte. Co je Cashu a co Lightning teď neřešte, nechte Cashu, je to
        jednodušší. Naťukáte částku, klepnete na Zaplatit a hotovo. Samozřejmě
        musíte mít v Linky dost prostředků, jinak je tlačítko Zaplatit šedé.
      </Paragraph>
      <DemoFigure
        screen="chat-payment"
        caption="Platba kontaktu dorazí do konverzace jako zpráva."
      />

      <Subheading>3.3 Peněženka</Subheading>
      <Paragraph>
        V záložce Peněženka vidíte uprostřed, kolik máte peněz. Klepáním na
        částku přepínáte měny. Pod ní jsou tlačítka Přijmout a Odeslat a odkaz
        Ukázat transakce. V Peněžence si do Linky posíláte peníze, přijímáte
        platby i od lidí, kteří Linky nemají (ti by to měli co nejdříve
        napravit), a platíte za zboží nebo služby.
      </Paragraph>
      <DemoFigure
        screen="wallet"
        caption="Záložka Peněženka: zůstatek, Přijmout, Odeslat a transakce."
      />

      <Subheading>3.3.1 Přijmout peníze</Subheading>
      <Paragraph>
        Klepnete na Přijmout a objeví se stránka Dobít účet. Naťukáte částku,
        kterou chcete dostat, klepáním na ni přepínáte měny, a klepnete na
        Zobrazit fakturu pro dobití. Faktura je prostě žádost o platbu s
        částkou, tak se tomu u bitcoinu říká.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topup}
        alt="Stránka Dobít účet s částkou 500 Kč, klávesnicí a tlačítky Zobrazit fakturu pro dobití, Bez částky a Vložit"
        caption="Dobít účet. Naťukáte částku a necháte si zobrazit fakturu."
      />
      <Paragraph>
        Zobrazí se stránka Faktura pro dobití s částkou, řádkem Mint: cashu.cz
        (mint teď neřešte, je to služba, která vám saty v Linky drží) a QR kódem
        s údaji platby. Pokud je plátce u vás, ukažte mu ho, on si ho načte do
        své peněženky a potvrdí platbu. Peníze vám do Linky přijdou prakticky
        ihned. Pokud plátce u vás není, použijte tlačítko Kopírovat pod QR
        kódem. Fakturu jako text pak vložíte do jakékoli aplikace, kterou spolu
        používáte, třeba do Signalu nebo e-mailu.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topupInvoice}
        alt="Stránka Faktura pro dobití s částkou, mintem cashu.cz, QR kódem a tlačítkem Kopírovat"
        caption="Faktura pro dobití. QR kód ukážete plátci, nebo fakturu zkopírujete a pošlete."
      />
      <Paragraph>
        Co přesně je v QR kódu, určuje Způsob přijímání v Nastavení, v sekci
        Platby. Na výběr je:
      </Paragraph>
      <BulletList
        items={[
          <>
            <b>Lightning</b>: běžná Lightning faktura. Zaplatí ji jakákoli
            bitcoinová peněženka s podporou Lightning.
          </>,
          <>
            <b>Cashu</b>: žádost pro peněženky, které umí Cashu. Platba dorazí
            přímo jako Cashu, bez Lightning poplatků.
          </>,
          <>
            <b>Univerzální</b>: obojí v jednom QR kódu. Peněženka plátce si
            vybere, co umí. Proto je přednastavený, nechte ho.
          </>,
        ]}
      />
      <Paragraph>
        Když chcete Linky dobít sami sobě, postup je stejný. Vytvoříte si
        fakturu a zaplatíte ji z jiné peněženky. Pokud ji máte v jiném telefonu,
        ukažte jí QR kód. Pokud ji máte ve stejném telefonu nebo na počítači,
        fakturu zkopírujte a do druhé peněženky vložte.
      </Paragraph>
      <Paragraph>
        Tlačítko Bez částky zobrazí QR kód vaší Lightning adresy. Na ni vám může
        kdokoli poslat libovolnou částku podle svého uvážení, i opakovaně, a vy
        nemusíte pokaždé vytvářet fakturu. Tlačítko Vložit vloží ze schránky buď
        částku, nebo rovnou fakturu či Cashu token, který vám někdo poslal.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topupNoAmount}
        alt="Stránka Přijmout libovolnou částku s QR kódem a Lightning adresou"
        caption="Bez částky: QR kód vaší Lightning adresy, na kterou vám kdokoli pošle, kolik chce."
      />

      <Subheading>3.3.2 Odeslat peníze</Subheading>
      <Paragraph>
        Klepněte na Odeslat. Otevře se skener QR kódů a pod ním Zadat příjemce
        ručně a tlačítka Vložit, Emitovat a Galerie. Nejčastěji prostě namíříte
        telefon na QR kód obchodníka nebo kamaráda, Linky ho načte, ukáže částku
        a vy potvrdíte.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.send}
        alt="Stránka Odeslat se skenerem QR kódů, položkou Zadat příjemce ručně a tlačítky Vložit, Emitovat a Galerie"
        caption="Odeslat. Skener načte QR kód, tlačítka pod ním řeší ostatní případy."
      />
      <BulletList
        items={[
          <>
            <b>Zadat příjemce ručně</b> použijete, když vám někdo poslal fakturu
            jako text. Do pole vložíte Lightning adresu, fakturu, LNURL nebo
            Cashu request. Když začnete psát jméno, Linky nabídne shodné
            kontakty.
          </>,
          <>
            <b>Vložit</b> udělá totéž rovnou se schránkou. Fakturu nebo adresu
            zkopírujete ze zprávy, klepnete na Vložit a je to.
          </>,
          <>
            <b>Galerie</b> načte QR kód z uloženého obrázku, třeba ze
            screenshotu.
          </>,
          <>
            <b>Emitovat</b> vytvoří Cashu token, tedy saty jako text nebo QR
            kód. Hodí se pro někoho, kdo ještě žádnou peněženku nemá. Pošlete mu
            ho jakoukoli aplikací a Linky mu pomůže token převzít.
          </>,
        ]}
      />
      <ScreenshotFigure
        shot={shots.manualPay}
        alt="Stránka Odeslat s polem Příjemce pro Lightning adresu, fakturu, LNURL nebo Cashu request"
        caption="Ruční zadání příjemce. Pole přijme Lightning adresu, fakturu, LNURL i Cashu request."
      />
      <DemoFigure
        screen="token-share"
        caption="Emitovaný token pošlete jakoukoli aplikací i člověku bez Linky."
      />

      <Heading>Co dál</Heading>
      <Paragraph>
        Tohle vám stačí na to, abyste si přidali první kontakty, dobili pár
        tisíc a začali platit. Zbytek, proxy platby, pravidelné platby nebo
        vlastní Linky jméno, objevíte, až ho budete potřebovat, Tutoriál v
        Nastavení vás k tomu dovede. A když něco nebude fungovat, napište
        autorům přímo v Linky: v Nastavení je položka Zpětná vazba.
      </Paragraph>
    </>
  );
}
