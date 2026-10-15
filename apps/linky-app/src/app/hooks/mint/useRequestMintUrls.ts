import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import {
  isHiddenTestMint,
  MAIN_MINT_URL,
  normalizeMintUrl,
} from "../../../utils/mint";
import { mintInfoDedupedAtom } from "../../state/wallet/mintInfo";
import { useAllowTestMints } from "../useAllowTestMints";
import { useDefaultMintUrl } from "../wallet/useDefaultMint";

/** The user's mints a payment request offers the payer, the default mint first. */
export const requestMintUrls = ({
  allowTestMints,
  defaultMintUrl,
  mintUrls,
}: {
  readonly allowTestMints: boolean;
  readonly defaultMintUrl: string | null;
  readonly mintUrls: ReadonlyArray<string>;
}): string[] => {
  const defaultMint =
    normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL) || MAIN_MINT_URL;
  return [
    ...new Set(
      [defaultMint, ...mintUrls.map(normalizeMintUrl)].filter(
        (mint) => mint && !isHiddenTestMint(mint, allowTestMints),
      ),
    ),
  ];
};

export const useRequestMintUrls = (): string[] => {
  const { allowTestMints } = useAllowTestMints();
  const defaultMintUrl = useDefaultMintUrl();
  const rows = useAtomValue(mintInfoDedupedAtom);
  return React.useMemo(
    () =>
      requestMintUrls({
        allowTestMints,
        defaultMintUrl,
        mintUrls: rows.map((entry) => entry.canonicalUrl),
      }),
    [allowTestMints, defaultMintUrl, rows],
  );
};
