import type { Article } from "../../article";
import { linkyTeam } from "../../authors";
import { Body as CzechBody } from "./cs";
import { Body as EnglishBody } from "./en";
import { cover } from "./media";

export const article: Article = {
  publishedOn: "2026-10-06",
  author: linkyTeam,
  cover,
  translations: {
    en: {
      title: "Linky 26.10.3: share your profile with one link",
      description:
        "Every Linky user now has a profile page at linky.fit/p/…, and whoever opens it lands in a conversation with you. The release also brings Nostr login for websites, Keryx announcements to try out, and a few fixes.",
      coverAlt: "A Linky profile page on a phone",
      Body: EnglishBody,
    },
    cs: {
      title: "Linky 26.10.3: sdílejte profil jedním odkazem",
      description:
        "Každý uživatel Linky má teď profilovou stránku na linky.fit/p/… a kdo ji otevře, je o klepnutí od konverzace s vámi. K tomu přihlášení na weby přes Nostr, experimentální oznámení firem (Keryx) a pár oprav.",
      coverAlt: "Profilová stránka Linky na telefonu",
      Body: CzechBody,
    },
  },
};
