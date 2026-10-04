import type { CompanyIdentity, IdentityChange } from "./domain";
import { isSha256Hex } from "./internal/crypto";
import { parseKeryxUrl } from "./internal/urls";

/**
 * Identity from master-signed `custom`. A linked logo without a valid
 * `logo_sha256` is a metadata error, so it is dropped and no logo is shown.
 */
export const identityFromCustom = (custom: {
  readonly company_name: string;
  readonly logo?: string | undefined;
  readonly logo_sha256?: string | undefined;
}): CompanyIdentity => {
  const { company_name: companyName, logo, logo_sha256: logoSha256 } = custom;
  if (logo?.startsWith("data:")) return { companyName, logo };
  return logo !== undefined &&
    parseKeryxUrl(logo) !== null &&
    logoSha256 !== undefined &&
    isSha256Hex(logoSha256)
    ? { companyName, logo, logoSha256 }
    : { companyName };
};

/**
 * Compare the identity the user acknowledged with the current one: a new
 * `companyName` is a rebrand (pair again), a new logo is cosmetic (one tap).
 */
export const identityChange = (
  acknowledged: CompanyIdentity,
  current: CompanyIdentity,
): IdentityChange => {
  if (acknowledged.companyName !== current.companyName) return "rebrand";
  return acknowledged.logo !== current.logo ||
    acknowledged.logoSha256 !== current.logoSha256
    ? "cosmetic"
    : "none";
};
