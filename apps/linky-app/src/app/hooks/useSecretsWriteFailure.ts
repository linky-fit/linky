import { useAtom } from "@linky-fit/linkstr-react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { secretsWriteFailureAtom } from "../state/session/secretsWrite";

export const reportSecretsWriteDecision = (decision: "cancel" | "retry") =>
  reportAppLog({
    tag: "session.secretsWriteDecided",
    summary: `The user chose to ${decision} after the secure store refused the keys`,
    payload: { decision },
  });

/** Keys the secure store refused, and the cancel that drops them; null while there are none. */
export const useSecretsWriteFailure = () => {
  const [failure, setFailure] = useAtom(secretsWriteFailureAtom);
  const cancel =
    failure === null
      ? null
      : () => {
          reportSecretsWriteDecision("cancel");
          setFailure(null);
        };
  return { failure, cancel };
};
