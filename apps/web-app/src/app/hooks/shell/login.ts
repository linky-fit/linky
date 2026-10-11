import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { loginCommandsAtom } from "../../state/shell/confirmations";

/** Answers to the LNURL-auth and site login sheets. */
export const useLoginCommands = () => {
  const commands = useAtomValue(loginCommandsAtom);
  return React.useMemo(
    () => ({
      closeLnurlAuthConfirmation: () =>
        commands?.read().closeLnurlAuthConfirmation(),
      closeSiteLoginConfirmation: () =>
        commands?.read().closeSiteLoginConfirmation(),
      confirmLnurlAuth: async () => commands?.read().confirmLnurlAuth(),
      confirmSiteLogin: async () => commands?.read().confirmSiteLogin(),
    }),
    [commands],
  );
};
