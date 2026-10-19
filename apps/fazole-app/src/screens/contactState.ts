import { Result } from "effect";
import { useEffect, useState } from "react";
import { copy } from "../copy";
import { parseContactInput } from "../domain";
import {
  resolveContact,
  type ContactFailure,
  type ResolvedContact,
} from "../services/contacts";

/** Where the contact lookup stands for what is typed. */
export type ContactState =
  /** Nothing typed, or nothing a lookup could take. */
  | { readonly kind: "idle" }
  | { readonly kind: "resolving" }
  | { readonly kind: "resolved"; readonly contact: ResolvedContact }
  | {
      readonly kind: "failed";
      readonly failure: ContactFailure;
      /** The address looked up, for the message. */
      readonly address: string | null;
    };

/** What a lookup failure tells the merchant. */
export const contactFailureText = (
  failure: ContactFailure,
  address: string | null,
): string => {
  switch (failure) {
    case "invalid":
      return copy.contact.invalid;
    case "not-found":
      return copy.contact.notFound(address ?? "");
    case "unreachable":
      return copy.contact.unreachable;
  }
};

// Typing pauses this long before the name is looked up.
const LOOKUP_DEBOUNCE_MS = 400;

/** Looks the typed contact up once typing pauses; resolving until the answer for this text is in. */
export const useContactLookup = (text: string): ContactState => {
  const [answer, setAnswer] = useState<{
    readonly text: string;
    readonly state: ContactState;
  } | null>(null);
  useEffect(() => {
    const input = parseContactInput(text);
    if (input === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void resolveContact(text, { signal: controller.signal }).then(
        (resolved) => {
          if (controller.signal.aborted) return;
          setAnswer({
            text,
            state: Result.isSuccess(resolved)
              ? { kind: "resolved", contact: resolved.success }
              : {
                  kind: "failed",
                  failure: resolved.failure,
                  address: input.kind === "nip05" ? input.address : null,
                },
          });
        },
        () => undefined,
      );
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [text]);
  if (parseContactInput(text) === null) return { kind: "idle" };
  return answer?.text === text ? answer.state : { kind: "resolving" };
};
