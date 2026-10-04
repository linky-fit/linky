import { ListRow, Section } from "@linky-fit/ui";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useKeryx, useRefreshOnOpen } from "../app/hooks/useKeryx";
import { navigateTo } from "../hooks/useRouting";
import { KeryxCompanyRow } from "./KeryxCompany";

export function KeryxSettingsSection() {
  const { t } = useAppShellCore();
  const { companies, refresh } = useKeryx();
  useRefreshOnOpen(companies, refresh);
  return (
    <Section title={t("keryxSection")}>
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
    </Section>
  );
}
