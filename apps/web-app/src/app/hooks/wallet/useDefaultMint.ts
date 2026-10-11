import { useAtomSuspense, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import {
  defaultMintAtom,
  defaultMintChoiceAtom,
  defaultMintCommandsAtom,
} from "../../state/wallet/defaultMint";
import { useSetting } from "../useLinksync";

/**
 * The default mint and its writes. Seeds a new account's default mint once
 * and takes over a choice synced from another device; only that direction
 * is watched, so two devices never ping-pong a stale value back.
 */
export const useDefaultMint = () => {
  const commands = useAtomSuspense(defaultMintCommandsAtom).value;
  const defaultMintChoice = useAtomValue(defaultMintChoiceAtom);
  const defaultMintUrl = useAtomValue(defaultMintAtom);
  const syncedDefaultMint = useSetting("defaultMint");

  React.useEffect(() => {
    void commands.seedOnboardingDefaultMint();
  }, [commands]);

  React.useEffect(() => {
    commands.adoptSyncedDefaultMint(syncedDefaultMint);
  }, [commands, syncedDefaultMint]);

  return {
    defaultMintChoice,
    defaultMintUrl,
    setDefaultMint: commands.setDefaultMint,
    suggestDefaultMint: commands.suggestDefaultMint,
  };
};
