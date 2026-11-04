import { Button, EmptyState, ListRow, Section } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useKeryx, useRefreshOnOpen } from "../app/hooks/useKeryx";
import { KeryxCompanyRow } from "../components/KeryxCompany";
import { navigateTo } from "../hooks/useRouting";

export function KeryxCompaniesPage(): React.ReactElement {
  const { t } = useTranslation();
  const { companies, refresh } = useKeryx();
  useRefreshOnOpen(companies, refresh);
  const addCompany = () => navigateTo({ route: "keryxCompanyNew" });
  if (companies.length === 0) {
    return (
      <EmptyState
        icon="Newspaper"
        title={t("keryxEmptyTitle")}
        description={t("keryxEmptyBody")}
        action={
          <Button icon="Plus" onPress={addCompany} testID="keryx-add-company">
            {t("keryxAddCompany")}
          </Button>
        }
      />
    );
  }
  return (
    <Section grouped>
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
        chevron={false}
        onPress={addCompany}
      />
    </Section>
  );
}
