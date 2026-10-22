import { OnchainTransferId } from "@linky-fit/domain";
import { Pubkey } from "@linky-fit/linkstr";
import { Schema } from "effect";

/** The main sections, one tab each. */
export const sections = [
  "transfers",
  "chats",
  "wallet",
  "stats",
  "settings",
] as const;
export type Section = (typeof sections)[number];

export type Route =
  | {
      readonly section: "transfers";
      readonly transferId: OnchainTransferId | null;
    }
  | { readonly section: "chats"; readonly peer: Pubkey | null }
  | { readonly section: "wallet" | "stats" | "settings" };

const isPubkey = Schema.is(Pubkey);

export const parseRoute = (hash: string): Route => {
  const [name = "", param = ""] = hash.replace(/^#\/?/u, "").split("/");
  switch (name) {
    case "chats":
      return { section: "chats", peer: isPubkey(param) ? param : null };
    case "wallet":
    case "stats":
    case "settings":
      return { section: name };
    default:
      return {
        section: "transfers",
        transferId: OnchainTransferId.is(param) ? param : null,
      };
  }
};

export const routeHash = (route: Route): string => {
  switch (route.section) {
    case "transfers":
      return route.transferId === null
        ? "#transfers"
        : `#transfers/${route.transferId}`;
    case "chats":
      return route.peer === null ? "#chats" : `#chats/${route.peer}`;
    default:
      return `#${route.section}`;
  }
};

export const transferRoute = (transferId: OnchainTransferId): Route => ({
  section: "transfers",
  transferId,
});

export const chatRoute = (peer: Pubkey): Route => ({ section: "chats", peer });

/** A section's own screen, e.g. for a tab press. */
export const sectionRoute = (section: Section): Route =>
  section === "transfers"
    ? { section, transferId: null }
    : section === "chats"
      ? { section, peer: null }
      : { section };
