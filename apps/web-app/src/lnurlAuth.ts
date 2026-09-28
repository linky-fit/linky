import * as lnurl from "@linky-fit/linkshu";
import { signLnurlAuthChallenge } from "@linky-fit/identity";
import { identityFromNsec } from "@linky-fit/linkstr";
import { hexToBytes } from "@noble/hashes/utils.js";
import { isNativePlatform } from "./platform/runtime";
export { isLnurlAuthTarget, parseLnurlAuthTarget } from "@linky-fit/linkshu";
export type { LnurlAuthAction, LnurlAuthPreview } from "@linky-fit/linkshu";

const fallback: lnurl.LnurlFallback = async (url) => {
  if (typeof window === "undefined") throw new Error("LNURL request failed");
  const origin = isNativePlatform() ? "https://app.linky.fit" : "";
  const response = await fetch(
    `${origin}/api/lnurlp?url=${encodeURIComponent(url)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
};

export const submitLnurlAuth = async ({
  nsec,
  preview,
}: {
  nsec: string;
  preview: lnurl.LnurlAuthPreview;
}): Promise<void> => {
  const identity = identityFromNsec(nsec);
  if (!identity) throw new Error("LNURL-auth needs an unlocked identity");

  await lnurl.submitLnurlAuth(
    {
      preview,
      sign: ({ challengeHex, domain }) =>
        signLnurlAuthChallenge({
          challenge: hexToBytes(challengeHex),
          domain,
          nostrSecretKey: identity.secretKey,
        }),
    },
    fallback,
  );
};
