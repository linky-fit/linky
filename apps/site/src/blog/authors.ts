import type { Author } from "./article";

export const hynek: Author = {
  name: "Hynek",
  avatar: "/blog/authors/hynek.jpg",
  bio: {
    en: "Founder of the Czech Jednadvacet community, product manager at Trezor and founder of Linky. Works mainly on bitcoin adoption.",
    cs: "Zakladatel české Jednadvacet, produkťák v Trezoru a zakladatel projektu Linky. Pracuje především na adopci bitcoinu.",
  },
  nostr: "npub1lz8xv2dnyryrk4vswkcgf52vqqzruqwuyp53s7pvusx4fef9fh2s7hh86s",
  x: "HynekJina",
};

export const linkyTeam: Author = {
  name: "Linky team",
  avatar: "/icon.svg",
  bio: {
    en: "The people building Linky.",
    cs: "Lidé, kteří staví Linky.",
  },
};
