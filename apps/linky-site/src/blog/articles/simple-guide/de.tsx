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
        Diese Anleitung beschreibt nicht alle Funktionen von Linky, und auch bei
        den beschriebenen nicht alle Möglichkeiten. Sie ist im Stil von „Wie
        mache ich das?“ und „Wie geht jenes?“ geschrieben, damit Sie Linky so
        schnell und so einfach wie möglich benutzen können. Wenn Sie die
        komplexeren Funktionen und Einstellungen wollen, sind Sie vermutlich
        schon so weit, dass Sie keine Anleitung mehr brauchen. Die Screenshots
        zeigen die tschechische App; die Schaltflächen sitzen in jeder Sprache
        an derselben Stelle.
      </Paragraph>

      <Heading>1. Installation</Heading>
      <Subheading>Android</Subheading>
      <Paragraph>
        Laden Sie Linky aus{" "}
        <TextLink href="https://play.google.com/store/apps/details?id=fit.linky.app">
          Google Play
        </TextLink>{" "}
        herunter. Geben Sie bei der Suche „Linky.fit“ ein; das Wort Linky allein
        findet auch andere Apps. Wer Zapstore nutzt, findet Linky auch dort.
        Nach der Installation geht es mit Teil 2, Konto anlegen, weiter.
      </Paragraph>
      <Subheading>iPhone</Subheading>
      <Paragraph>
        Im App Store gibt es Linky noch nicht. Auf dem iPhone speichern und
        starten Sie es als Web-App (PWA). Öffnen Sie in Safari{" "}
        <TextLink href="https://app.linky.fit">app.linky.fit</TextLink>, tippen
        Sie auf Teilen, wählen Sie Zum Home-Bildschirm und bestätigen Sie mit
        Hinzufügen. Auf dem Home-Bildschirm erscheint ein Linky-Symbol, und die
        App verhält sich dann wie jede andere.
      </Paragraph>
      <Paragraph>
        Dieselbe Adresse app.linky.fit funktioniert auch im Browser am Computer.
        Es gibt ein Konto; Telefon und Computer können es gleichzeitig nutzen.
      </Paragraph>

      <Heading>2. Konto anlegen</Heading>
      <Paragraph>
        Sie müssen nirgends eine Telefonnummer oder E-Mail-Adresse eingeben.
        Öffnen Sie Linky und tippen Sie auf Profil erstellen. Geben Sie den
        Namen ein, unter dem Sie in Linky auftreten wollen, und tippen Sie auf
        Weiter. Auf der nächsten Seite „Wie sehen dich die anderen?“ ist schon
        ein Avatar für Sie erzeugt. Sie können ihn mit Neuer Avatar tauschen,
        ein Foto hochladen oder gleich ein Foto aufnehmen. All das lässt sich
        später im Tab Profil ändern, tippen Sie also ruhig auf Profil
        bestätigen. Linky öffnet sich im Tab Kontakte.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.welcome}
        alt="Der Startbildschirm von Linky mit den Schaltflächen Profil erstellen und Ich habe schon ein Profil"
        caption="Der Startbildschirm. Ein neues Konto legen Sie mit Profil erstellen an, ein bestehendes stellen Sie mit Ich habe schon ein Profil wieder her."
      />
      <ScreenshotFigure
        shot={shots.picture}
        alt="Die Seite Wie sehen dich die anderen mit einem Avatar und den Schaltflächen Foto hochladen, Foto aufnehmen und Neuer Avatar"
        caption="Einen Avatar haben Sie sofort. Ein Foto können Sie jetzt hochladen oder jederzeit später."
      />
      <Paragraph>
        Die Schaltfläche Ich habe schon ein Profil stellt ein Konto aus seinen
        Schlüsseln wieder her. Dazu kommen wir in Teil 2.2.
      </Paragraph>

      <Subheading>2.1 Die Checkliste für den Einstieg</Subheading>
      <Paragraph>
        Oben auf der Seite Kontakte steht die Checkliste Erste Schritte mit
        Ihrem Stand, etwa 1/8 abgeschlossen, und der Aufgabe, die als Nächstes
        dran ist. Sie können Linky sofort benutzen; die Aufgaben führen Sie nur
        durch die Grundfunktionen. Die Schaltfläche Anleitung anzeigen bringt
        Sie Schritt für Schritt an die richtige Stelle in der App. Die ersten
        fünf Aufgaben sind die Grundlagen:
      </Paragraph>
      <BulletList
        items={[
          "Kontakt hinzufügen",
          "Nachricht senden",
          "Bitcoin empfangen",
          "Schlüssel sichern",
          "Bezahlen",
        ]}
      />
      <Paragraph>
        Die übrigen drei, einen eigenen Linky-Namen registrieren, Kontaktgruppen
        und Proxy-Zahlungen einrichten, können warten, bis Sie sich
        zurechtfinden. In der Android-App gibt es noch eine neunte Aufgabe, das
        Einschalten des Beacons, mit dem Kontakte in der Nähe Sie sehen.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.checklist}
        alt="Der Tab Kontakte mit der Checkliste Erste Schritte, dem Stand 1/8 und der Aufgabe Nachricht senden"
        caption="Die Checkliste Erste Schritte auf der Seite Kontakte zeigt die Aufgabe, die als Nächstes dran ist."
      />
      <Paragraph>
        Die Checkliste können Sie mit dem Kreuz oben rechts ausblenden. Das wird
        in Ihrem Konto gespeichert, sie kommt also weder nach einem Neustart
        noch auf einem anderen Gerät zurück. Die vollständige Liste der Aufgaben
        finden Sie jederzeit in den Einstellungen unter Anleitung, und dort
        können Sie sich jede erneut zeigen lassen.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.tutorial}
        alt="Die Seite Anleitung in den Einstellungen mit einer Liste von acht Aufgaben und Schaltflächen Anleitung anzeigen"
        caption="Anleitung in den Einstellungen: alle Aufgaben auf einen Blick, jede mit einer Schaltfläche Anleitung anzeigen."
      />
      <Paragraph>
        Die wichtigste Aufgabe ist das Sichern der Schlüssel, deshalb kommt sie
        gleich als Nächstes.
      </Paragraph>

      <Subheading>2.2 Schlüssel und ihre Sicherung</Subheading>
      <Paragraph>
        Die Schlüssel hat Linky beim Anlegen des Profils selbst erzeugt; Sie
        müssen nichts generieren. Sie brauchen sie in drei Situationen: wenn Sie
        Ihr Profil auf ein anderes Telefon übertragen, wenn Ihr jetziges Telefon
        kaputtgeht, verloren geht oder gestohlen wird, und wenn Sie in den
        Einstellungen Abmelden benutzen. Das Abmelden löscht die Daten von Linky
        vom Telefon, und ohne Schlüssel kommen Sie nicht mehr an das Konto und
        damit an Ihr Geld. Solange Sie sich nicht abmelden, starten Sie Linky
        einfach mit einem Tipp auf das Symbol.
      </Paragraph>
      <Paragraph>
        Die Schlüssel finden Sie in den Einstellungen im Abschnitt Sicherheit
        unter Hauptschlüssel. Es sind 20 Wörter. Anzeigen zeigt sie, Kopieren
        legt sie in die Zwischenablage, und In Passwörtern speichern übergibt
        sie dem Passwort-Manager auf Ihrem Telefon, falls Sie einen haben.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.masterKeys}
        alt="Die Seite Hauptschlüssel mit zwanzig verdeckten Wörtern und den Schaltflächen Kopieren, Anzeigen und In Passwörtern speichern"
        caption="Hauptschlüssel in den Einstellungen. Die Wörter bleiben verdeckt, bis Sie auf Anzeigen tippen."
      />
      <Paragraph>
        Zum Wiederherstellen auf einem anderen Gerät tippen Sie auf Ich habe
        schon ein Profil. Entweder fügen Sie alle Wörter auf einmal mit Aus
        Zwischenablage einfügen ein, oder Sie tippen sie eines nach dem anderen
        in die zwanzig Felder; Linky prüft jedes davon. Das dritte und vierte
        Wort einer Linky-Sicherung ist immer „academic“, das ist kein
        Tippfehler. Mit denselben Schritten öffnen Sie Linky auf einem zweiten
        Gerät, etwa dem Computer, und beide Geräte laufen dann nebeneinander.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.restore}
        alt="Die Seite Willkommen zurück mit der Schaltfläche Aus Zwischenablage einfügen und Feldern für 20 Wörter"
        caption="Konto wiederherstellen: die Wörter aus der Zwischenablage einfügen oder einzeln eintippen."
      />
      <Paragraph>
        Bei einer Hardware-Wallet dürfen Sie die Schlüssel (den Seed) niemals
        elektronisch speichern, weder als Text noch als Foto, damit kein
        Unbefugter an sie herankommt. In Linky werden die Schlüssel auf dem
        Telefon erzeugt; wenn Sie sie elektronisch speichern, etwa im
        Passwort-Manager, machen Sie es damit nicht viel schlimmer. Lassen Sie
        sie vor allem nicht nur auf dem Telefon, das Sie gerade benutzen. Bei
        Beschädigung oder Verlust wäre die Wiederherstellung verloren. Wir
        empfehlen, die Schlüssel zusätzlich auf Papier zu schreiben und
        aufzubewahren oder eine andere, haltbarere Sicherung zu verwenden.
      </Paragraph>
      <Paragraph>
        Linky ist nicht dafür gedacht, große Beträge aufzubewahren; dafür gibt
        es Hardware-Wallets. Legen Sie in Linky nur kleinere Summen ab, ein paar
        hundert Euro, so viel, wie Sie früher im Portemonnaie hatten. Wenn Sie
        wissen, dass Sie etwas Teureres kaufen oder zu einer Veranstaltung
        fahren, wo Sie mit Bitcoin zahlen, laden Sie Linky mit mehr auf. Deshalb
        stört es weniger, dass die Schlüssel elektronisch gespeichert sind. Käme
        ein Unbefugter an sie heran, wäre das kein fataler Verlust.
      </Paragraph>

      <Heading>3. Wallet, Kontakte und Nachrichten</Heading>
      <Paragraph>
        Linky ist eine Bitcoin-Wallet, aber Sie schicken Ihren Kontakten darin
        auch Nachrichten, Fotos und PDF-Dateien. Unten auf dem Bildschirm ist
        eine Leiste mit den Tabs Profil (Ihr Avatar), Kontakte, Wallet,
        Proxy-Zahlungen und Einstellungen. Linky öffnet sich im Tab Kontakte.
        Proxy-Zahlungen überspringen wir in dieser Anleitung; am Anfang brauchen
        Sie sie nicht.
      </Paragraph>
      <Paragraph>
        Auch wenn Linky eine Wallet ist, beginnen wir mit den Kontakten, denn
        Sie brauchen sie auch für Zahlungen und für das Abschließen der
        Checkliste.
      </Paragraph>

      <Subheading>3.1 Kontakte</Subheading>
      <Paragraph>
        Unter Kontakte sehen Sie die Leute, mit denen Sie in Linky schreiben und
        bezahlen. Das sind nicht die Kontakte mit Telefonnummern aus Ihrem
        Telefon; die liest Linky nicht. Wen Sie wollen, den fügen Sie in Linky
        hinzu. Bei jedem Kontakt stehen Avatar, Name, Uhrzeit und eine Vorschau
        der letzten Nachricht. Ein Tipp auf den Kontakt öffnet Ihre gemeinsame
        Unterhaltung.
      </Paragraph>
      <DemoFigure
        screen="contacts"
        caption="Der Tab Kontakte. Unten rechts ist die Schaltfläche zum Hinzufügen eines Kontakts."
      />

      <Subheading>3.1.1 Einen Kontakt in Linky hinzufügen</Subheading>
      <Paragraph>
        Unten rechts ist eine Schaltfläche mit einer Figur und einem Plus. Sie
        öffnet die Seite Kontakt hinzufügen. Oben steht die große Schaltfläche
        Kontakt-QR scannen, darunter ein Suchfeld und unten Vorschläge: Leute in
        der Nähe und neue Linky-Nutzer. Linky erinnert Sie daran, nur
        vertrauenswürdige Kontakte hinzuzufügen, die Sie persönlich kennen.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactNew}
        alt="Die Seite Kontakt hinzufügen mit der Schaltfläche Kontakt-QR scannen, einem Suchfeld und Vorschlägen"
        caption="Kontakt hinzufügen. Am schnellsten geht es, den QR-Code der anderen Person zu scannen."
      />
      <Paragraph>
        Wenn Sie nebeneinander stehen, ist das Scannen des QR-Codes am
        schnellsten. Die andere Person öffnet ihren Tab Profil, wo ihr QR-Code
        steht, und Sie tippen auf Kontakt-QR scannen. Oder umgekehrt: Sie zeigen
        Ihr Profil und lassen sich scannen.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.profile}
        alt="Der Tab Profil mit Avatar, Name, QR-Code, der Schaltfläche Profil teilen und einer Lightning-Adresse"
        caption="Der Tab Profil. Den QR-Code scannt die andere Person; den Link verschicken Sie mit Profil teilen."
      />
      <Paragraph>
        Wenn Sie nicht beisammen sind, tippen Sie in das Suchfeld einen Namen
        oder Spitznamen. Linky sucht unter den Leuten, die Linky oder einen
        anderen Client des Nostr-Netzwerks nutzen, auf dem Linky läuft. Oft
        findet es mehrere Leute mit demselben Namen. Als ich „Petr“ eingab, fand
        es sechs. Den richtigen Petr erkennen Sie am Avatar, und wenn nicht,
        fragen Sie ihn. Neben dem richtigen Namen tippen Sie auf Hinzufügen, und
        der Kontakt wird gespeichert. Bei jemandem, den Sie schon haben, steht
        stattdessen Öffnen.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactSearch}
        alt="Die Seite Kontakt hinzufügen mit Suchergebnissen für den Namen Hynek und Schaltflächen Hinzufügen"
        caption="Suche nach Namen. Neben der gefundenen Person tippen Sie auf Hinzufügen."
      />
      <Paragraph>Statt eines Namens nimmt dasselbe Feld auch:</Paragraph>
      <BulletList
        items={[
          <>
            Einen <b>npub</b>, eine lange Zeichenkette, die mit npub1 beginnt.
            Das ist die öffentliche Kennung eines Kontos, so etwas wie eine
            Kontonummer, die Ihnen die andere Person schickt. Das Symbol rechts
            im Feld fügt sie aus der Zwischenablage ein.
          </>,
          <>
            Einen <b>NIP-05</b>, einen verifizierten Namen in der Form
            name@domain.de, falls die andere Person einen eingerichtet hat.
          </>,
          <>
            Einen <b>reservierten Namen</b>, also einen Namen, den jemand auf
            linky.fit registriert hat. Tippen Sie einfach zum Beispiel „alice“.
          </>,
          <>
            Die <b>Lightning-Adresse</b> von jemandem, der Linky nicht hat.
            Linky bietet Lightning-Adresse speichern an, und Sie können ihm dann
            Geld schicken, auch wenn Sie nicht miteinander schreiben.
          </>,
        ]}
      />
      <Paragraph>
        Wenn Linky nichts findet, bietet es die Schaltfläche Kontakt erstellen
        an, und Sie tragen die Daten von Hand ein.
      </Paragraph>
      <Paragraph>
        Aus der Ferne ist ein Profil-Link am bequemsten. Jeder Linky-Nutzer hat
        eine Seite unter linky.fit/p/… und verschickt sie aus dem Tab Profil mit
        Profil teilen. Wer den Link öffnet, tippt auf In Linky öffnen und hat
        Sie in den Kontakten, mit einem schon vorgetippten Gruß.
      </Paragraph>
      <DemoFigure
        screen="profile-open"
        caption="Mia öffnet den Profil-Link, tippt auf In Linky öffnen und grüßt Dave."
      />

      <Subheading>3.1.2 Kontaktdaten, Gruppen und Löschen</Subheading>
      <Paragraph>
        Wenn Sie in einer Unterhaltung oben rechts auf den Stift tippen, öffnet
        sich die Seite Kontakt bearbeiten mit den Feldern Name, Kennung,
        Lightning-Adresse und Gruppe. Sobald Sie etwas ändern, erscheint unten
        die Schaltfläche Änderungen speichern.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactEdit}
        alt="Die Seite Kontakt bearbeiten mit den Feldern Name, Kennung, Lightning-Adresse und Gruppe und einem Papierkorb-Symbol oben rechts"
        caption="Kontakt bearbeiten. Der Papierkorb oben rechts löscht den Kontakt."
      />
      <Paragraph>
        Den Namen ändern Sie, wie Sie wollen; Linky zeigt ihn nur Ihnen. Die
        Kennung lassen Sie besser in Ruhe; das ist der npub, an dem Linky den
        Kontakt erkennt. Bei Linky-Nutzern hat die Lightning-Adresse die Form
        npub…@linky.fit. Registriert der Kontakt einen eigenen Namen, etwa
        pepa@linky.fit, sehen Sie diese Adresse. In das Feld Gruppe tippen Sie
        zum Beispiel Familie und bestätigen mit Enter. Mit einem neuen Namen
        entsteht die Gruppe, und unter Kontakte können Sie dann nach Gruppen
        filtern. Ein Tipp auf eine vorhandene Gruppe fügt den Kontakt ihr hinzu.
      </Paragraph>
      <Paragraph>
        Das Papierkorb-Symbol oben rechts löscht den Kontakt mit einem Tipp.
        Gleich danach erscheint unten Rückgängig, falls Sie sich vertan haben.
        Und wenn die gelöschte Person Ihnen wieder schreibt, kommt der Kontakt
        von selbst zurück, sodass Ihnen keine Nachricht entgeht.
      </Paragraph>

      <Subheading>3.2 Nachrichten</Subheading>
      <Paragraph>
        Um jemandem zu schreiben, tippen Sie auf seinen Kontakt. Die
        Unterhaltung öffnet sich, unten ist das Feld Nachricht. Daneben ist die
        Schaltfläche für Anhänge, mit der Sie ein Bild oder ein PDF hinzufügen.
        Achtung: Wählen Sie den Anhang, bevor Sie zu tippen beginnen. Sobald
        etwas im Feld steht, wird aus der Anhang-Schaltfläche Senden. Ein Bild
        darf bis zu 20 MB haben, ein PDF 2 MB.
      </Paragraph>
      <Paragraph>
        Wenn Sie auf eine Nachricht tippen, bietet Linky eine Reihe Emojis für
        eine Reaktion (das Plus öffnet den ganzen Emoji-Katalog) und die
        Aktionen Antworten, Kopieren und Löschen. Bei eigenen Textnachrichten
        kommt Bearbeiten dazu. Das Löschen gilt für beide Seiten; anstelle der
        Nachricht bleibt bei Ihnen wie beim Gegenüber nur „Nachricht gelöscht“.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.messageActions}
        alt="Das Menü der Nachrichtenaktionen mit Reaktionen und den Einträgen Antworten, Bearbeiten, Kopieren und Löschen"
        caption="Tipp auf eine Nachricht: Reaktionen, Antworten, Bearbeiten, Kopieren und Löschen."
      />

      <Subheading>3.2.1 Zahlungen zwischen Ihnen und einem Kontakt</Subheading>
      <Paragraph>
        Unten in der Unterhaltung sind die Schaltflächen Anfordern und Bezahlen.
        Ob Linky Ihnen Euro oder eine andere Währung zeigt, verschickt werden
        immer Sats, Bruchteile eines Bitcoins. Den Betrag können Sie trotzdem in
        Euro eingeben, etwa 20 EUR, und Linky rechnet ihn um. Ein Tipp auf den
        Betrag wechselt zwischen den Währungen. Standardmäßig sind Ihre
        Landeswährung und Sats eingeschaltet; weitere Währungen fügen Sie in den
        Einstellungen unter Einheiten hinzu.
      </Paragraph>
      <Paragraph>
        Mit Anfordern bitten Sie einen Kontakt, Ihnen zu zahlen. Auf der Seite
        Kontakt bezahlen tippen Sie den Betrag ein, fügen bei Bedarf eine Notiz
        hinzu und tippen auf Anfordern. In der Unterhaltung erscheint eine
        Zahlungsanforderung mit dem Betrag. Die andere Person bezahlt sie mit
        einem Tipp, oder sie lehnt ab, und Sie sehen bei der Anforderung
        Abgelehnt.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.contactRequest}
        alt="Die Seite Kontakt bezahlen mit einem Betrag, einem Ziffernblock und der Schaltfläche Anfordern"
        caption="Eine Zahlungsanforderung. Den Betrag tippen Sie auf dem Ziffernblock ein und tippen auf Anfordern."
      />
      <DemoFigure
        screen="chat-request"
        caption="Eine Zahlungsanforderung in der Unterhaltung. Die andere Person bestätigt sie mit einem Tipp."
      />
      <Paragraph>
        Mit Bezahlen schicken Sie einem Kontakt Geld. Auf derselben Seite
        Kontakt bezahlen sehen Sie den Namen des Empfängers, den verfügbaren
        Betrag und neben dem Namen ein kleines Symbol. Eine Bohne steht für
        Cashu, ein Blitz für Lightning; ein Tipp wechselt zwischen beiden. Was
        Cashu und Lightning sind, ist jetzt egal; lassen Sie Cashu, das ist
        einfacher. Betrag eintippen, auf Bezahlen tippen, fertig. Natürlich
        brauchen Sie genug Guthaben in Linky, sonst ist die Schaltfläche
        Bezahlen ausgegraut.
      </Paragraph>
      <DemoFigure
        screen="chat-payment"
        caption="Eine Zahlung an einen Kontakt kommt als Nachricht in der Unterhaltung an."
      />

      <Subheading>3.3 Wallet</Subheading>
      <Paragraph>
        Im Tab Wallet sehen Sie in der Mitte, wie viel Geld Sie haben. Ein Tipp
        auf den Betrag wechselt die Währung. Darunter sind die Schaltflächen
        Empfangen und Senden und der Link Transaktionen anzeigen. In der Wallet
        schicken Sie Geld in Linky, empfangen Zahlungen auch von Leuten, die
        Linky nicht haben (sie sollten das bald ändern), und bezahlen Waren oder
        Dienstleistungen.
      </Paragraph>
      <DemoFigure
        screen="wallet"
        caption="Der Tab Wallet: Guthaben, Empfangen, Senden und Transaktionen."
      />

      <Subheading>3.3.1 Geld empfangen</Subheading>
      <Paragraph>
        Tippen Sie auf Empfangen, und die Seite Konto aufladen erscheint. Tippen
        Sie den Betrag ein, den Sie bekommen wollen, mit einem Tipp auf den
        Betrag wechseln Sie die Währung, und tippen Sie auf Aufladerechnung
        anzeigen. Eine Rechnung ist einfach eine Zahlungsaufforderung über einen
        Betrag; so heißt das bei Bitcoin.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topup}
        alt="Die Seite Konto aufladen mit einem Betrag, einem Ziffernblock und den Schaltflächen Aufladerechnung anzeigen, Beliebiger Betrag und Einfügen"
        caption="Konto aufladen. Betrag eintippen und die Rechnung anzeigen lassen."
      />
      <Paragraph>
        Die Seite Aufladerechnung zeigt den Betrag, die Zeile Mint: cashu.cz (um
        den Mint kümmern Sie sich jetzt nicht; das ist der Dienst, der Ihre Sats
        in Linky verwahrt) und einen QR-Code mit den Zahlungsdaten. Ist der
        Zahler bei Ihnen, zeigen Sie ihn ihm; er scannt ihn in seine Wallet und
        bestätigt die Zahlung. Das Geld kommt praktisch sofort in Ihrem Linky
        an. Ist der Zahler nicht bei Ihnen, benutzen Sie die Schaltfläche
        Kopieren unter dem QR-Code. Die Rechnung als Text fügen Sie dann in jede
        App ein, die Sie beide benutzen, etwa Signal oder E-Mail.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topupInvoice}
        alt="Die Seite Aufladerechnung mit Betrag, dem Mint cashu.cz, einem QR-Code und der Schaltfläche Kopieren"
        caption="Die Aufladerechnung. Den QR-Code zeigen Sie dem Zahler, oder Sie kopieren die Rechnung und verschicken sie."
      />
      <Paragraph>
        Was genau im QR-Code steckt, bestimmt die Empfangsmethode in den
        Einstellungen im Abschnitt Zahlungen. Zur Wahl stehen:
      </Paragraph>
      <BulletList
        items={[
          <>
            <b>Lightning</b>: eine gewöhnliche Lightning-Rechnung. Jede
            Bitcoin-Wallet mit Lightning bezahlt sie.
          </>,
          <>
            <b>Cashu</b>: eine Anforderung für Wallets, die Cashu können. Die
            Zahlung kommt direkt als Cashu an, ohne Lightning-Gebühren.
          </>,
          <>
            <b>Universell</b>: beides in einem QR-Code. Die Wallet des Zahlers
            nimmt, was sie kann. Deshalb ist das voreingestellt; lassen Sie es
            so.
          </>,
        ]}
      />
      <Paragraph>
        Wenn Sie Linky selbst aufladen wollen, ist der Ablauf derselbe. Sie
        erstellen eine Rechnung und bezahlen sie aus einer anderen Wallet. Ist
        die auf einem anderen Telefon, zeigen Sie ihr den QR-Code. Ist sie auf
        demselben Telefon oder am Computer, kopieren Sie die Rechnung und fügen
        sie in die andere Wallet ein.
      </Paragraph>
      <Paragraph>
        Die Schaltfläche Beliebiger Betrag zeigt den QR-Code Ihrer
        Lightning-Adresse. Darauf kann Ihnen jeder einen beliebigen Betrag nach
        eigenem Ermessen schicken, auch wiederholt, und Sie müssen nicht jedes
        Mal eine Rechnung erstellen. Die Schaltfläche Einfügen fügt aus der
        Zwischenablage entweder einen Betrag ein oder gleich eine Rechnung oder
        einen Cashu-Token, den Ihnen jemand geschickt hat.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.topupNoAmount}
        alt="Die Seite Beliebigen Betrag empfangen mit einem QR-Code und einer Lightning-Adresse"
        caption="Beliebiger Betrag: der QR-Code Ihrer Lightning-Adresse, auf die Ihnen jeder schicken kann, so viel er will."
      />

      <Subheading>3.3.2 Geld senden</Subheading>
      <Paragraph>
        Tippen Sie auf Senden. Es öffnet sich ein QR-Scanner, darunter Empfänger
        eingeben und die Schaltflächen Einfügen, Ausstellen und Galerie.
        Meistens richten Sie das Telefon einfach auf den QR-Code eines Händlers
        oder Freundes, Linky liest ihn, zeigt den Betrag, und Sie bestätigen.
      </Paragraph>
      <ScreenshotFigure
        shot={shots.send}
        alt="Die Seite Senden mit einem QR-Scanner, dem Eintrag Empfänger eingeben und den Schaltflächen Einfügen, Ausstellen und Galerie"
        caption="Senden. Der Scanner liest einen QR-Code; die Schaltflächen darunter decken die übrigen Fälle ab."
      />
      <BulletList
        items={[
          <>
            <b>Empfänger eingeben</b> benutzen Sie, wenn Ihnen jemand eine
            Rechnung als Text geschickt hat. In das Feld fügen Sie eine
            Lightning-Adresse, eine Rechnung, eine LNURL oder eine
            Cashu-Anforderung ein. Wenn Sie einen Namen tippen, schlägt Linky
            passende Kontakte vor.
          </>,
          <>
            <b>Einfügen</b> macht dasselbe direkt mit der Zwischenablage.
            Rechnung oder Adresse aus der Nachricht kopieren, auf Einfügen
            tippen, fertig.
          </>,
          <>
            <b>Galerie</b> liest einen QR-Code aus einem gespeicherten Bild,
            etwa einem Screenshot.
          </>,
          <>
            <b>Ausstellen</b> erzeugt einen Cashu-Token, also Sats als Text oder
            QR-Code. Das ist praktisch für jemanden, der noch keine Wallet hat.
            Schicken Sie ihm den Token mit einer beliebigen App, und Linky hilft
            ihm, ihn einzulösen.
          </>,
        ]}
      />
      <ScreenshotFigure
        shot={shots.manualPay}
        alt="Die Seite Senden mit dem Feld Empfänger für eine Lightning-Adresse, eine Rechnung, eine LNURL oder eine Cashu-Anforderung"
        caption="Empfänger eingeben. Das Feld nimmt eine Lightning-Adresse, eine Rechnung, eine LNURL oder eine Cashu-Anforderung."
      />
      <DemoFigure
        screen="token-share"
        caption="Einen ausgestellten Token verschicken Sie mit jeder App, auch an jemanden ohne Linky."
      />

      <Heading>Wie es weitergeht</Heading>
      <Paragraph>
        Das reicht, um die ersten Kontakte hinzuzufügen, ein wenig aufzuladen
        und mit dem Bezahlen anzufangen. Den Rest, Proxy-Zahlungen, regelmäßige
        Zahlungen oder einen eigenen Linky-Namen, entdecken Sie, wenn Sie ihn
        brauchen; die Anleitung in den Einstellungen führt Sie hin. Und wenn
        etwas nicht funktioniert, schreiben Sie den Autoren direkt in Linky: In
        den Einstellungen gibt es den Eintrag Feedback.
      </Paragraph>
    </>
  );
}
