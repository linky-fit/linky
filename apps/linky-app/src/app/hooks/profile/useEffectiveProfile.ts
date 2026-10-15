import { useAtomValue } from "@linky-fit/linkstr-react";
import { effectiveProfileAtom } from "../../state/contacts/profiles";

/** The own profile as shown: published fields, else the identity's defaults. */
export const useEffectiveProfile = () => useAtomValue(effectiveProfileAtom);
