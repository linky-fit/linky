import type { Article } from "../../article";
import { hynek } from "../../authors";
import { Body as CzechBody } from "./cs";
import { Body as GermanBody } from "./de";
import { Body as EnglishBody } from "./en";
import { cover } from "./media";

export const article: Article = {
  publishedOn: "2026-10-28",
  author: hynek,
  cover,
  translations: {
    en: {
      title: "How to find your contacts in Linky",
      description:
        "Linky knows no phone numbers or e-mails, so you start with an empty contact list. Six ways to fill it with people you know: a QR code, new users, search by name, people nearby, sharing contacts in a message and an NFC card.",
      coverAlt:
        "Three phones with the Linky app: contacts nearby, adding a contact and contacts shared in a chat",
      Body: EnglishBody,
    },
    cs: {
      title: "Jak v Linky najít své kontakty",
      description:
        "Linky nezná telefonní čísla ani e-maily, takže začínáte s prázdným seznamem kontaktů. Tady je šest způsobů, jak do něj dostat lidi, které znáte: QR kód, noví uživatelé, hledání podle jména, lidé v okolí, sdílení kontaktů ve zprávě a NFC karta.",
      coverAlt:
        "Tři telefony s aplikací Linky: kontakty v okolí, přidání kontaktu a sdílené kontakty v chatu",
      Body: CzechBody,
    },
    de: {
      title: "So finden Sie Ihre Kontakte in Linky",
      description:
        "Linky kennt weder Telefonnummern noch E-Mails, Sie starten also mit einer leeren Kontaktliste. Sechs Wege, sie mit Menschen zu füllen, die Sie kennen: QR-Code, neue Nutzer, Suche nach Namen, Menschen in der Nähe, Kontakte in einer Nachricht teilen und eine NFC-Karte.",
      coverAlt:
        "Drei Telefone mit der Linky-App: Kontakte in der Nähe, Kontakt hinzufügen und im Chat geteilte Kontakte",
      Body: GermanBody,
    },
  },
};
