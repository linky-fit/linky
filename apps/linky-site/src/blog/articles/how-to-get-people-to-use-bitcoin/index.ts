import type { Article } from "../../article";
import { hynek } from "../../authors";
import { Body as CzechBody } from "./cs";
import { Body as EnglishBody } from "./en";
import { cover } from "./media";

export const article: Article = {
  publishedOn: "2026-10-01",
  author: hynek,
  cover,
  translations: {
    en: {
      title: "How to Get People to Use Bitcoin",
      description:
        "Adoption isn’t an optional bonus but a fundamental condition for bitcoin to actually be useful. What I’ve tried over the years, why onboarding merchants isn’t enough, and how proxy payments in Linky let you pay with bitcoin almost anywhere.",
      coverAlt: "The landlord of the Zlaté sele pub behind the bar",
      Body: EnglishBody,
    },
    cs: {
      title: "Jak přimět lidi používat bitcoin",
      description:
        "Adopce není bonus navíc, ale základní podmínka, aby bitcoin skutečně sloužil. Co jsem za roky zkoušel, proč nestačí onboardovat obchodníky a jak proxy platby v Linky umožňují platit bitcoinem téměř kdekoliv.",
      coverAlt: "Hostinský ze Zlatého Selete za výčepem",
      Body: CzechBody,
    },
  },
};
