import * as lnurl from "@linky-fit/linkshu";
import { signLnurlAuthChallenge } from "@linky-fit/identity";
import { identityFromNsec } from "@linky-fit/linkstr";
import { hexToBytes } from "@noble/hashes/utils.js";
import { apiUrl } from "./platform/runtime";
export { isLnurlAuthTarget, parseLnurlAuthTarget } from "@linky-fit/linkshu";
export type { LnurlAuthAction, LnurlAuthPreview } from "@linky-fit/linkshu";

// Throws only when the proxy itself cannot be reached; linkshu reads the
// proxied status and body, so an upstream error keeps its reason.
const fallback: lnurl.LnurlFallback = (url) =>
  fetch(apiUrl(`/api/lnurlp?url=${encodeURIComponent(url)}`), {
    headers: { Accept: "application/json" },
  });

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
