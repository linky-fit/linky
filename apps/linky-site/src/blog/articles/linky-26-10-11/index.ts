import type { Article } from "../../article";
import { dejv } from "../../authors";
import { Body as CzechBody } from "./cs";
import { Body as EnglishBody } from "./en";
import { cover } from "./media";

export const article: Article = {
  publishedOn: "2026-11-04",
  author: dejv,
  cover,
  translations: {
    en: {
      title: "Linky 26.10.11: cash, goods and services among friends",
      description:
        "Proxy payments became Collaboration: bank transfers paid by a friend, cash, and goods and services, shared only with contacts who saved you too. The scanner now sits top right on every main tab.",
      coverAlt:
        "Two Linky screens: the Cash page with Looking for cash chosen, and Goods and services with the contacts' listings",
      Body: EnglishBody,
    },
    cs: {
      title: "Linky 26.10.11: hotovost, zboží a služby mezi přáteli",
      description:
        "Z Proxy plateb je Spolupráce: platební převody za kamaráda, hotovost a zboží a služby, které vidí jen kontakty, které si uložily i vás. Skener je teď vpravo nahoře na každé hlavní záložce.",
      coverAlt:
        "Dvě obrazovky Linky: stránka Hotovost se zvolenou poptávkou a Zboží a služby s nabídkami kontaktů",
      Body: CzechBody,
    },
  },
};
