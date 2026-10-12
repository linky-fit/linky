import type { Article } from "../../article";
import { dejv } from "../../authors";
import { Body as CzechBody } from "./cs";
import { Body as EnglishBody } from "./en";
import { cover } from "./media";

export const article: Article = {
  publishedOn: "2026-10-12",
  author: dejv,
  cover,
  translations: {
    en: {
      title: "Linky 26.10.4: you decide what stays",
      description:
        "Delete a message for both sides, react with any emoji, delete and block contacts. The release also brings notifications on Android phones without Google, restoring an account with one paste and a Nostr identity page.",
      coverAlt:
        "Three Linky screens: the emoji list in a chat, a contact deleted with Block offered, and the restore screen filled with words",
      Body: EnglishBody,
    },
    cs: {
      title: "Linky 26.10.4: co zůstane, rozhodujete vy",
      description:
        "Smazání zprávy u obou stran, reakce jakýmkoli emoji, mazání a blokování kontaktů. K tomu notifikace na Androidu bez Googlu, obnova účtu jedním vložením a stránka Nostr identita.",
      coverAlt:
        "Tři obrazovky Linky: seznam emoji v chatu, smazaný kontakt s nabídkou Blokovat a obnova účtu s vyplněnými slovy",
      Body: CzechBody,
    },
  },
};
