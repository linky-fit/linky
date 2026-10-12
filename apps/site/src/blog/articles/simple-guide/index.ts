import type { Article } from "../../article";
import { karelson } from "../../authors";
import { Body as CzechBody } from "./cs";
import { Body as GermanBody } from "./de";
import { Body as EnglishBody } from "./en";
import { cover } from "./media";

export const article: Article = {
  publishedOn: "2026-10-12",
  author: karelson,
  cover,
  translations: {
    en: {
      title: "A simple guide to using Linky",
      description:
        "How to install Linky, create an account, back up your keys, add a contact, write messages and send and receive bitcoin. Step by step, without the advanced features.",
      coverAlt: "Phones showing screens of the Linky app",
      Body: EnglishBody,
    },
    cs: {
      title: "Jednoduchý návod na používání Linky",
      description:
        "Jak si Linky nainstalovat, založit účet, zálohovat klíče, přidat kontakt, psát zprávy a posílat i přijímat bitcoin. Krok za krokem, bez složitých funkcí.",
      coverAlt: "Telefony s obrazovkami aplikace Linky",
      Body: CzechBody,
    },
    de: {
      title: "Eine einfache Anleitung für Linky",
      description:
        "Wie Sie Linky installieren, ein Konto anlegen, die Schlüssel sichern, einen Kontakt hinzufügen, Nachrichten schreiben und Bitcoin senden und empfangen. Schritt für Schritt, ohne die komplexen Funktionen.",
      coverAlt: "Telefone mit Bildschirmen der Linky-App",
      Body: GermanBody,
    },
  },
};
