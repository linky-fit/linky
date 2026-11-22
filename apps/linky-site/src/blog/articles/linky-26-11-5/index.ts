import type { Article } from "../../article";
import { dejv } from "../../authors";
import { Body as CzechBody } from "./cs";
import { Body as EnglishBody } from "./en";
import { cover } from "./media";
import { Body as SlovakBody } from "./sk";

export const article: Article = {
  publishedOn: "2026-11-22",
  author: dejv,
  cover,
  translations: {
    en: {
      title:
        "Linky 26.11.5: Slovak, non-stop on-chain transfers and faster payments",
      description:
        "Linky and the website now speak Slovak, on-chain transfers run non-stop with a block explorer link on sends, and busy wallets pay roughly twice as fast.",
      coverAlt:
        "Two Linky screens: the app switched to Slovak with an EUR balance, and a completed on-chain send showing its payout address and explorer link",
      Body: EnglishBody,
    },
    cs: {
      title:
        "Linky 26.11.5: slovenština, on-chain převody non-stop a rychlejší platby",
      description:
        "Linky i web teď mluví slovensky, on-chain převody běží non-stop s odkazem do prohlížeče blockchainu a dlouho používané peněženky platí zhruba dvakrát rychleji.",
      coverAlt:
        "Dvě obrazovky Linky: aplikace přepnutá do slovenštiny se zůstatkem v eurech a dokončené on-chain odeslání s cílovou adresou a odkazem do prohlížeče",
      Body: CzechBody,
    },
    sk: {
      title:
        "Linky 26.11.5: slovenčina, on-chain prevody non-stop a rýchlejšie platby",
      description:
        "Linky aj web teraz hovoria po slovensky, on-chain prevody bežia non-stop s odkazom do prehliadača blockchainu a dlho používané peňaženky platia zhruba dvakrát rýchlejšie.",
      coverAlt:
        "Dve obrazovky Linky: aplikácia prepnutá do slovenčiny so zostatkom v eurách a dokončené on-chain odoslanie s cieľovou adresou a odkazom do prehliadača",
      Body: SlovakBody,
    },
  },
};
