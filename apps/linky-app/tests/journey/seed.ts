// Builds the JSON payload for `bun run journey seed <device>`, reusing the app's
// heavy account defaults, deterministic shard pointer ids, and active mint keyset.
import { linkyScopes, shardPointerId } from "@linky-fit/linksync";
import {
  parseSeedArgs,
  SEED_USAGE,
} from "../../src/devtools/e2e/seedAccountHistory";
import {
  buildDeterministicContacts,
  fetchActiveSatKeysetId,
} from "../helpers/heavyAccount";

const parsed = parseSeedArgs(process.argv.slice(2));
if (parsed.help) {
  console.error(SEED_USAGE);
  process.exit(0);
}
const mintUrl = process.env.LINKSHU_MINT_URL;
if (!mintUrl) {
  throw new Error(
    "LINKSHU_MINT_URL is not set; run this through bun run journey",
  );
}
const keysetId = await fetchActiveSatKeysetId(mintUrl);
const payload = {
  history: {
    mint: mintUrl,
    keysetId,
    ...parsed.counts,
  },
  fallbackContacts: buildDeterministicContacts(
    Math.max(1, parsed.counts.contacts),
  ),
  pointerIds: {
    contacts: shardPointerId("contacts"),
    messages: shardPointerId("messages"),
    transactions: shardPointerId("transactions"),
  },
  maxMutations: {
    contacts: linkyScopes.contacts.rotation.maxMutations,
    messages: linkyScopes.messages.rotation.maxMutations,
    transactions: linkyScopes.transactions.rotation.maxMutations,
  },
  hookedOrigin: process.env.LINKY_JOURNEY_HOOKED_PORT
    ? `http://localhost:${process.env.LINKY_JOURNEY_HOOKED_PORT}`
    : null,
};
console.log(JSON.stringify(payload));
