import type { CashIntent } from "@linky-fit/linkstr";
import { EmptyState, SegmentedControl, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useBeaconSupport } from "../app/hooks/useBeacon";
import { useCashIntent } from "../app/hooks/useCashIntent";
import {
  useCashContacts,
  type SharingContact,
} from "../app/hooks/useCollaboration";
import { NearbyBeaconSection } from "../components/NearbyBeaconSection";
import { PeopleRow } from "../components/PeopleRow";
import type { I18nKey } from "../i18n";

type CashChoice = CashIntent | "none";

const CHOICES: ReadonlyArray<{
  value: CashChoice;
  label: I18nKey;
  hint: I18nKey;
}> = [
  { value: "offer", label: "cashIntentOffer", hint: "cashIntentOfferHint" },
  { value: "none", label: "cashIntentNone", hint: "cashIntentNoneHint" },
  { value: "want", label: "cashIntentWant", hint: "cashIntentWantHint" },
];

function CashSection({
  contacts,
  emptyKey,
  titleKey,
}: {
  contacts: ReadonlyArray<SharingContact>;
  emptyKey: I18nKey;
  titleKey: I18nKey;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Stack gap="$sm">
      <Text variant="title" role="heading">
        {t(titleKey)}
      </Text>
      {contacts.length === 0 ? (
        <Text color="$colorMuted">{t(emptyKey)}</Text>
      ) : (
        <PeopleRow people={contacts} />
      )}
    </Stack>
  );
}

export function CashPage(): React.ReactElement {
  const { t } = useTranslation();
  const { cashIntent, setCashIntent } = useCashIntent();
  const { offering, wanting } = useCashContacts();
  const beaconSupported = useBeaconSupport();
  const choice: CashChoice = cashIntent ?? "none";
  const hint = CHOICES.find((option) => option.value === choice)?.hint;

  return (
    <Stack gap="$xxxl">
      <Text color="$colorMuted">{t("cashLead")}</Text>

      <Stack gap="$sm" data-guide="cash-intent">
        <SegmentedControl
          accessibilityLabel={t("cash")}
          value={choice}
          options={CHOICES.map(({ value, label }) => ({
            value,
            label: t(label),
          }))}
          onValueChange={(next) =>
            void setCashIntent(next === "none" ? null : next)
          }
        />
        {hint ? (
          <Text variant="caption" color="$colorMuted">
            {t(hint)}
          </Text>
        ) : null}
      </Stack>

      {offering.length === 0 && wanting.length === 0 ? (
        <EmptyState icon="Banknote" title={t("cashNobodyYet")} />
      ) : (
        <>
          <CashSection
            contacts={offering}
            titleKey="cashOffering"
            emptyKey="cashOfferingEmpty"
          />
          <CashSection
            contacts={wanting}
            titleKey="cashWanting"
            emptyKey="cashWantingEmpty"
          />
        </>
      )}

      {beaconSupported ? (
        <NearbyBeaconSection offerOnMount t={t} />
      ) : (
        <Text variant="label" fontWeight="$regular" color="$colorMuted">
          {t("listingsMutualOnly")}
        </Text>
      )}
    </Stack>
  );
}
