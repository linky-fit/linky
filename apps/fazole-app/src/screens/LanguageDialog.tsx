import { Dialog, ListRow } from "@linky-fit/ui";
import { copy } from "../copy";
import {
  language,
  LANGUAGE_NAMES,
  LANGUAGES,
  switchLanguage,
} from "../platform/language";

/** Picks the app language; choosing another one reloads into it. */
export function LanguageDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}
      title={copy.settings.language}
      closeLabel={copy.close}
      testID="language-dialog"
    >
      {LANGUAGES.map((option) => (
        <ListRow
          key={option}
          testID={`language-${option}`}
          title={LANGUAGE_NAMES[option]}
          selected={option === language}
          chevron={false}
          onPress={() =>
            option === language ? onClose() : void switchLanguage(option)
          }
        />
      ))}
    </Dialog>
  );
}
