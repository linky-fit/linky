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
        Wer WhatsApp oder Signal installiert, hat in Sekunden Dutzende Kontakte,
        abgeglichen über die Telefonnummer. Linky kann das mit Absicht nicht.
        Wir wollen weder Telefonnummer noch E-Mail noch einen Ausweis. Ein
        Linky-Konto entsteht aus Schlüsseln, die das Telefon selbst erzeugt.
      </Paragraph>
      <Paragraph>
        Das hat einen ziemlich unangenehmen Nachteil. Nach der Installation ist
        der Tab Kontakte leer, und die App weiß nicht, wen Sie tatsächlich
        kennen. Deshalb legen wir in Linky viel Wert darauf, dass Sie die Person
        neben sich, oder die, mit der Sie schon woanders schreiben, so einfach
        wie möglich finden. Hier ist ein Überblick über alle Wege, die heute in
        Linky funktionieren.
      </Paragraph>

      <Heading>1. QR-Code</Heading>
      <Paragraph>
        Der Klassiker, und er funktioniert auf jedem Telefon und im Web. Jeder
        Linky-Nutzer hat seinen QR-Code im Tab Profil. Die andere Person tippt
        in Kontakte auf den Button mit der Figur und dem Plus, dann auf{" "}
        <Term>Kontakt-QR scannen</Term>, und hält die Kamera darauf. Oder
        umgekehrt: Sie scannen ihren.
      </Paragraph>
      <Paragraph>
        Wenn Sie nicht am selben Ort sind, schicken Sie statt des QR-Codes einen
        Link. Der Button <Term>Profil teilen</Term> erzeugt eine Adresse
        linky.fit/p/…, die Sie in jedem Messenger verschicken können. Wer sie
        öffnet, sieht Ihren Namen und Avatar und fügt Sie mit dem Button{" "}
        <Term>Open in Linky</Term> hinzu.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.profile}
          alt="Der Tab Profil mit Avatar, Name, QR-Code und dem Button Profil teilen"
          caption="Der QR-Code im Tab Profil. Einfach zeigen, die andere Seite scannt ihn."
        />
        <DemoFigure
          screen="profile-open"
          caption="Mia bekommt einen Profil-Link, tippt auf Open in Linky und hat Dave in ihren Kontakten."
        />
      </FigureRow>

      <Heading>2. Neue Nutzer</Heading>
      <AsideFigure
        shot={shots.contactNew}
        alt="Die Seite Kontakt hinzufügen mit dem Button Kontakt-QR scannen, dem Suchfeld und zwei neuen Nutzern unter Vorschläge"
        caption="Vorschläge unten auf Kontakt hinzufügen: Linky-Nutzer aus der letzten Stunde."
      >
        <Paragraph>
          Die Situation, die wir am häufigsten erleben: Ein Freund neben Ihnen
          hat gerade Linky installiert und Sie wollen ihm die ersten Sats
          schicken. Deshalb zeigt die Seite <Term>Kontakt hinzufügen</Term>{" "}
          unten in den Vorschlägen die Konten der letzten Stunde mit dem
          Abzeichen <Term>Neu</Term>. Meist ist genau dieser Freund darunter.
          Antippen, fertig.
        </Paragraph>
        <Paragraph>
          Bedenken Sie, dass jeder seinen Namen und Avatar selbst wählt. Bevor
          Sie einem neuen Kontakt etwas schicken, vergewissern Sie sich, dass es
          wirklich die Person ist, für die Sie sie halten. Fügen Sie nur
          Menschen hinzu, die Sie persönlich kennen.
        </Paragraph>
      </AsideFigure>

      <Heading>3. Suche nach dem registrierten Namen</Heading>
      <Paragraph>
        Auf der Seite <Term>Kontakt hinzufügen</Term> liegt unter dem QR-Button
        ein Suchfeld. Am zuverlässigsten ist die Suche nach dem Linky-Namen, den
        jemand registriert hat. Hat Alice in ihrem Profil die Adresse
        alice@linky.fit reserviert, reicht „alice“ und Linky findet sie. Den
        Namen registrieren Sie im Tab Profil über den Stift und{" "}
        <Term>Adresse reservieren</Term>, bezahlt in Sats aus der Wallet.
        Genauso funktioniert ein verifizierter Name aus einer anderen App im
        Nostr-Netzwerk, in der Form name@domain.de.
      </Paragraph>
      <Paragraph>In dasselbe Feld können Sie auch eingeben:</Paragraph>
      <BulletList
        items={[
          <>
            <b>Einen Namen oder Spitznamen.</b> Linky durchsucht die Profile im
            Nostr-Netzwerk, auf dem es läuft. Oft findet es mehrere Personen mit
            demselben Namen; die richtige erkennen Sie am Avatar, und wenn
            nicht, fragen Sie nach.
          </>,
          <>
            <b>Einen npub</b>, die lange Zeichenkette, die mit npub1 beginnt.
            Das ist die öffentliche Kennung eines Kontos, die Ihnen die andere
            Person schicken kann. Das Symbol rechts fügt sie aus der
            Zwischenablage ein.
          </>,
          <>
            <b>Die Lightning-Adresse</b> von jemandem ohne Linky. Schreiben
            werden Sie nicht, aber Geld schicken können Sie.
          </>,
        ]}
      />
      <ScreenshotFigure
        shot={shots.contactSearch}
        alt="Die Seite Kontakt hinzufügen mit Suchergebnissen für den Namen hynek; das erste Ergebnis hat die Adresse hynek@linky.fit"
        caption="Suche nach Namen. Der registrierte Linky-Name steht in der Liste ganz oben."
      />

      <Heading>4. Menschen in der Nähe</Heading>
      <Paragraph>
        Der <Term>Beacon</Term> ist für Räume mit mehreren Linky-Nutzern
        gedacht, etwa ein Meetup. Über Bluetooth meldet Ihr Telefon, dass Sie in
        der Nähe sind, und hört auf die anderen. Solange Linky geöffnet ist,
        sieht jeder, der die Umgebung scannt, Ihren npub und kann Sie
        hinzufügen. Auf der Seite <Term>Kontakt hinzufügen</Term> erscheinen
        solche Personen in den Vorschlägen mit dem Abzeichen{" "}
        <Term>In der Nähe</Term>.
      </Paragraph>
      <Paragraph>
        Kontakte, die Sie gespeichert haben und die Sie gespeichert haben, sehen
        außerdem, wenn Sie in der Nähe sind. Dem Beacon können Sie eine Absicht
        mitgeben, <Term>Kauft BTC</Term> oder <Term>Verkauft BTC</Term>. Wer auf
        dem Meetup Sats gegen Bargeld kaufen will, sieht sofort, wer von seinen
        Bekannten verkauft.
      </Paragraph>
      <Paragraph>
        Den Beacon schalten Sie im Tab <Term>Proxy-Zahlungen</Term> im Abschnitt{" "}
        <Term>In der Nähe</Term> ein. Vorerst ist das eine experimentelle
        Funktion der Android-App, deshalb müssen Sie sie zuerst in den{" "}
        <Term>Einstellungen</Term> im Abschnitt <Term>Debug</Term> freischalten.
        Sie braucht Bluetooth und zeigt, solange sie läuft, eine
        Benachrichtigung, damit Sie wissen, dass Sie senden.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.contactsNearby}
          alt="Der Tab Kontakte mit dem Abschnitt In der Nähe und den Avataren Du, Mia mit dem Abzeichen Verkauft BTC, Dave und Ben"
          caption="Kontakte in der Nähe oben im Tab Kontakte. Mia hat mitgeteilt, dass sie Bitcoin verkauft."
        />
        <ScreenshotFigure
          shot={shots.beacon}
          alt="Der Tab Proxy-Zahlungen mit eingeschaltetem Beacon, der an drei Kontakte sendet, und der Auswahl Verkauft BTC"
          caption="Der Beacon im Tab Proxy-Zahlungen: Schalter, Sendestatus und was Sie handeln möchten."
        />
      </FigureRow>

      <Heading>5. Kontakte und Gruppen in einer Nachricht teilen</Heading>
      <AsideFigure
        shot={shots.chatContacts}
        alt="Ein Chat mit Mia, die die Gruppe Kletterer mit drei Kontakten und dem Button Alle hinzufügen geschickt hat"
        caption="Mia hat die ganze Gruppe Kletterer geschickt. Der Button Alle hinzufügen speichert drei Kontakte auf einmal."
        side="left"
      >
        <Paragraph>
          Sobald Sie ein paar Kontakte haben, führt der natürlichste Weg zu
          weiteren über sie. Tippen Sie im Chat <Term>@</Term> und beginnen Sie,
          einen Namen zu schreiben. Linky schlägt Ihre Kontakte vor, und der
          eingefügte Kontakt erscheint in der gesendeten Nachricht als Pille mit
          Avatar. Der Empfänger tippt darauf und speichert ihn.
        </Paragraph>
        <Paragraph>
          Dasselbe gilt für ganze Gruppen. Wenn Ihre Kontakte in Gruppen
          sortiert sind, etwa Kletterer oder Familie, fügt{" "}
          <Term>@Kletterer</Term> alle auf einmal ein. Die andere Seite bekommt
          unter der Nachricht den Button <Term>Alle hinzufügen</Term> und kann
          die neuen Kontakte danach gleich in eine eigene Gruppe einordnen. Eine
          Person erspart so dem Rest der Runde das Scannen von sechs QR-Codes.
        </Paragraph>
      </AsideFigure>

      <Heading>6. NFC-Karte</Heading>
      <Paragraph>
        Ein anderer Weg, jemandem den eigenen Kontakt zu geben, ist eine Karte
        an sein Telefon zu halten. In der Android-App hat der Tab Profil den
        Button <Term>Auf Tag schreiben</Term>. Er schreibt Ihre öffentliche
        Kennung, den npub, auf einen beliebigen NFC-Tag oder eine Karte. Wer die
        Karte dann an ein Telefon mit Linky hält, bekommt Ihr Profil geöffnet
        und speichert Sie mit einem Tipp. Nichts scannen, nichts tippen.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.profileNfc}
          alt="Der Tab Profil mit QR-Code und den Buttons Profil teilen und Auf Tag schreiben"
          caption="Der Button Auf Tag schreiben im Tab Profil schreibt Ihren npub auf eine NFC-Karte."
        />
        <ScreenshotFigure
          shot={shots.nfcModal}
          alt="Der Dialog Bereit zum Scannen mit der Aufforderung, einen NFC-Tag anzuhalten"
          caption="Nach dem Tipp einfach den Tag an die Rückseite des Telefons halten."
        />
      </FigureRow>
      <Paragraph>
        Leere NFC-Tags kosten fast nichts, und eine Linky-Karte passt neben die
        Bankkarte in die Geldbörse. Auf dem Meetup reichen Sie sie über den
        Tisch, im Laden halten Sie sie an die Kasse. Genauso lassen sich Sats
        auf einen Tag laden, aber das ist ein anderer Artikel.
      </Paragraph>

      <Heading>Sie brauchen keine Hunderte von Kontakten</Heading>
      <Paragraph>
        Die leere Liste am Anfang wirkt wie ein Nachteil, hat aber auch eine
        andere Seite. In Linky schleppen Sie keine Hunderte von Leuten mit, mit
        denen Sie vor zehn Jahren Nummern getauscht haben. Sie haben nur die,
        die Sie selbst hinzugefügt haben und wirklich kennen. Für eine Wallet
        ist das genau das Richtige. Sie bezahlen Menschen, denen Sie vertrauen,
        und sie bezahlen Sie.
      </Paragraph>
      <Paragraph>
        Ein paar Kontakte reichen. Der Freund, mit dem Sie das Mittagessen
        teilen, jemand aus der Familie und ein, zwei Leute, die Ihnen Sats gegen
        Bargeld verkaufen. Das Netz wächst dann von selbst: Jeder neue Kontakt
        kann Ihnen seine Kontakte und Gruppen in einer Nachricht schicken. Und
        haben Sie keine Scheu, Kontakte zu löschen, die Sie zufällig hinzugefügt
        haben und bei denen Sie nicht mehr wissen, wer das genau ist. Schreibt
        Ihnen so jemand wieder, kommt der Kontakt samt Verlauf von allein
        zurück.
      </Paragraph>
      <Paragraph>
        Und wenn Sie noch niemanden mit Linky kennen, gehen Sie zum nächsten
        Bitcoin-Meetup oder zu einer Konferenz. Dort gibt es die meisten
        NFC-Karten, QR-Codes und eingeschalteten Beacons, und die ersten
        Kontakte nehmen Sie an einem Abend mit. Linky dreht sich am Ende vor
        allem um Menschen; Bitcoin ist nur der Weg, Wert zwischen ihnen zu
        bewegen.
      </Paragraph>
    </>
  );
}
