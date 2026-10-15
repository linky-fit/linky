import { useAtomValue } from "@linky-fit/linkstr-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  messagesCommandsAtom,
  type MessagesCommands,
} from "../../state/messages/commands";

/** The message commands; null while signed out or before the store opens. */
export const useMessagesCommands = (): MessagesCommands | null =>
  Option.getOrNull(AsyncResult.value(useAtomValue(messagesCommandsAtom)));
