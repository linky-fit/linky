import {
  LINKY_BOT_NPUB,
  SUPPORTER_ACCEPTED_MINTS,
  SUPPORTER_TIERS,
  supporterTierIncludes,
  type SupporterTier,
} from "@linky-fit/supporter";
import type { ContactId } from "@linky-fit/linksync";
import { decodeNpub, type Pubkey } from "@linky-fit/linkstr";
import { type RecurringPaymentOrder } from "@linky-fit/recurring-payment";
import type { I18nKey } from "../../i18n";
import { isHiddenTestMint, normalizeMintUrl } from "../../utils/mint";
import type { SendMintBalance } from "./paymentMintSelection";

const env = import.meta.env;

const commaList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const positiveInt = (value: string | undefined): number | undefined => {
  const parsed = Number.parseInt(value ?? "", 10);
  return parsed > 0 ? parsed : undefined;
};

const envMints = commaList(env.VITE_SUPPORTER_ACCEPTED_MINTS);

/** The identity supporter payments go to; null until it launches, and Donate pays the Linky contact. */
export const linkyBotNpub: string | null =
  env.VITE_LINKY_BOT_NPUB?.trim() || LINKY_BOT_NPUB;

/** Linky Bot's pubkey: the only issuer whose results and badges count. */
export const linkyBotPubkey: Pubkey | null =
  linkyBotNpub === null ? null : decodeNpub(linkyBotNpub);

export const SUPPORTER_TIER_LABEL_KEYS = {
  bronze: "supporterTierBronze",
  silver: "supporterTierSilver",
  gold: "supporterTierGold",
  diamond: "supporterTierDiamond",
} as const satisfies Record<SupporterTier, I18nKey>;

/** Mints a supporter payment may come from, normalized. */
export const supporterAcceptedMints: ReadonlyArray<string> = (
  envMints.length > 0 ? envMints : SUPPORTER_ACCEPTED_MINTS
).map(normalizeMintUrl);

/** A shortened award validity for trying lapses and renewals; production builds ignore it. */
export const supporterValiditySeconds: number | undefined =
  env.DEV || env.VITE_E2E === "1"
    ? positiveInt(env.VITE_SUPPORTER_VALIDITY_SECONDS)
    : undefined;

/** The themes a tier unlocks: its own and every lower tier's. */
export const supporterThemesFor = (
  tier: SupporterTier,
): ReadonlyArray<SupporterTier> =>
  SUPPORTER_TIERS.filter((theme) => supporterTierIncludes(tier, theme));

/** The visible accepted mints that alone can cover `amountSat`, largest balance first. */
export const supporterPaymentMints = (
  balances: ReadonlyArray<SendMintBalance>,
  amountSat: number,
  allowTestMints: boolean,
  acceptedMints: ReadonlyArray<string> = supporterAcceptedMints,
): ReadonlyArray<SendMintBalance> =>
  balances
    .filter(
      ({ amount, mint }) =>
        amount >= amountSat &&
        acceptedMints.includes(normalizeMintUrl(mint)) &&
        !isHiddenTestMint(mint, allowTestMints),
    )
    .sort((a, b) => b.amount - a.amount);

/** A live recurring payment to Linky Bot, paused or not; a second one would pay twice once both run. */
export const supporterRecurringPayment = (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  linkyBotContactId: ContactId,
): RecurringPaymentOrder | null =>
  orders.find((order) => order.contactId === linkyBotContactId) ?? null;
