import { useEffect, useState } from "react";
import {
  loadEmojiSearchIndex,
  type EmojiSearchIndex,
} from "../../lib/emojiSearch";
import type { Lang } from "../../../utils/lang";
import { useTranslation } from "../shell";

/** The emoji search index in the user's language, loaded once `enabled` first turns true; null until then. */
export const useEmojiSearchIndex = (
  enabled: boolean,
): EmojiSearchIndex | null => {
  const { lang } = useTranslation();
  const [loaded, setLoaded] = useState<{
    index: EmojiSearchIndex;
    lang: Lang;
  } | null>(null);
  const isLoaded = loaded?.lang === lang;

  useEffect(() => {
    if (!enabled || isLoaded) return;
    let active = true;
    loadEmojiSearchIndex(lang).then(
      (index) => {
        if (active) setLoaded({ index, lang });
      },
      // Search stays empty until it is enabled again, which retries the load.
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [enabled, isLoaded, lang]);

  return isLoaded ? loaded.index : null;
};
