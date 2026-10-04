import { ListRow, Stack } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useKeryx, useRefreshOnOpen } from "../app/hooks/useKeryx";
import { KeryxCompanyRow } from "../components/KeryxCompany";
import { navigateTo } from "../hooks/useRouting";

export function KeryxCompaniesPage(): React.ReactElement {
  const { t } = useAppShellCore();
  const { companies, refresh } = useKeryx();
  useRefreshOnOpen(companies, refresh);
  return (
    <Stack>
      {companies.map(({ id, subscription }) => (
        <KeryxCompanyRow
          key={id}
          origin={subscription.origin}
          identity={subscription.identity}
          onPress={() => navigateTo({ route: "keryxCompany", id })}
        />
      ))}
      <ListRow
        icon="Plus"
        title={t("keryxAddCompany")}
        testID="keryx-add-company"
        onPress={() => navigateTo({ route: "keryxCompanyNew" })}
      />
    </Stack>
  );
}
