import { ListRow, Section, Spinner, Stack } from "@linky-fit/ui";
import React from "react";
import { useDedupeContacts } from "../app/hooks/contacts/useDedupeContacts";
import { useTranslation } from "../app/hooks/shell";
import { useSetNavIntent } from "../app/hooks/shell/navIntents";
import { useAppDataActions } from "../app/hooks/useAppDataTransfer";
import { navigateTo } from "../hooks/useRouting";
import { updateAndReloadApp } from "../platform/serviceWorker";
import { pickFile } from "../utils/pickFile";

/** Advanced and maintenance tools moved off the main Settings screen. */
export function DeveloperPage(): React.ReactElement {
  const { dedupeContacts, dedupeContactsIsBusy } = useDedupeContacts();
  const { exportAppData, handleImportAppDataFilePicked } = useAppDataActions();
  const setCashuTokensBackTo = useSetNavIntent("cashuTokensBackTo");
  const setEvoluDataBackTo = useSetNavIntent("evoluDataBackTo");
  const { t } = useTranslation();

  return (
    <Stack gap="$xl">
      <Section grouped>
        <ListRow
          icon="Coins"
          title={t("tokens")}
          onPress={() => {
            setCashuTokensBackTo("advanced");
            navigateTo({ route: "cashuTokens" });
          }}
        />
        <ListRow
          icon="Upload"
          title={t("exportData")}
          onPress={exportAppData}
        />
        <ListRow
          icon="Download"
          title={t("importData")}
          onPress={() => {
            void pickFile(".txt,.json,application/json,text/plain").then(
              handleImportAppDataFilePicked,
            );
          }}
        />
        <ListRow
          icon="BrushCleaning"
          title={t("dedupeContacts")}
          onPress={() => void dedupeContacts()}
          trailing={dedupeContactsIsBusy ? <Spinner /> : null}
          disabled={dedupeContactsIsBusy}
        />
        <ListRow
          icon="RotateCw"
          title={t("reloadApp")}
          onPress={() => void updateAndReloadApp()}
        />
      </Section>

      <Section grouped>
        <ListRow
          icon="Bug"
          title={t("nostrInspector")}
          onPress={() => navigateTo({ route: "advancedInspector" })}
        />
        <ListRow
          icon="Cloud"
          title={t("evoluData")}
          onPress={() => {
            setEvoluDataBackTo("advanced");
            navigateTo({ route: "evoluCurrentData" });
          }}
        />
        <ListRow
          icon="FlaskConical"
          title={t("pushDebug")}
          onPress={() => navigateTo({ route: "advancedPushDebug" })}
        />
      </Section>
    </Stack>
  );
}
