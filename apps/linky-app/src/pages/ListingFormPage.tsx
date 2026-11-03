import type { ListingSide } from "@linky-fit/linkstr";
import {
  createId,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
  type ListingId,
} from "@linky-fit/linksync";
import {
  Button,
  Row,
  SegmentedControl,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import React from "react";
import { reportAppLog } from "../devtools/inspector/appLog";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  useListingRecords,
  useListingsRepository,
} from "../app/hooks/useLinksync";
import {
  LISTING_SIDES,
  listingCurrencyChoices,
  listingCurrencyLabel,
  listingCurrencyOfDisplay,
  normalizeListingAmount,
} from "../app/lib/listings";
import { runWrite } from "../app/lib/storeWrite";
import { allowedDisplayCurrenciesAtom } from "../app/state/shell/displayPrefs";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { nowSeconds } from "../utils/time";

const SIDE_KEYS: Record<ListingSide, I18nKey> = {
  offer: "listingSideOffer",
  want: "listingSideWant",
};

const isSide = (side: string): side is ListingSide =>
  LISTING_SIDES.some((value) => value === side);

/** Adds a listing, or edits the one with `id`. The price is in the display currency the user has on, sats included. */
export function ListingFormPage({
  id = null,
}: {
  id?: ListingId | null;
}): React.ReactElement {
  const { lang, t } = useTranslation();
  const { displayCurrency } = useDisplayAmounts();
  const allowedDisplayCurrencies = useAtomValue(allowedDisplayCurrenciesAtom);
  const repository = useListingsRepository();
  const records = useListingRecords();
  const existing = id
    ? (records.find((record) => record.id === id) ?? null)
    : null;

  const [side, setSide] = React.useState<ListingSide>("offer");
  const [title, setTitle] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [unit, setUnit] = React.useState("");
  // A new listing takes the display currency; an edit keeps the currency it was priced in.
  const [currency, setCurrency] = React.useState(() =>
    listingCurrencyOfDisplay(displayCurrency),
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // An edit starts from the stored row once it is read.
  const loadedId = React.useRef<ListingId | null>(null);
  React.useEffect(() => {
    if (!existing || loadedId.current === existing.id) return;
    loadedId.current = existing.id;
    if (isSide(existing.side)) setSide(existing.side);
    setTitle(existing.title);
    setAmount(existing.amount);
    setUnit(existing.unit);
    setCurrency(existing.currency);
  }, [existing]);

  // Tapping the unit cycles through the device's display currencies.
  const currencyChoices = listingCurrencyChoices(
    allowedDisplayCurrencies,
    currency,
  );
  const nextCurrency = () => {
    const index = currencyChoices.indexOf(currency);
    const next = currencyChoices[(index + 1) % currencyChoices.length];
    if (next !== undefined) setCurrency(next);
  };

  const normalizedAmount = normalizeListingAmount(amount, currency);
  const canSave =
    title.trim().length > 0 &&
    unit.trim().length > 0 &&
    normalizedAmount !== null;

  const back = () => navigateTo({ route: "listings" });

  const save = async () => {
    if (!canSave || normalizedAmount === null) return;
    setIsSaving(true);
    setError(null);
    const columns = {
      side: NonEmptyString100.orThrow(side),
      title: NonEmptyString1000.orThrow(title.trim()),
      amount: NonEmptyString100.orThrow(normalizedAmount),
      currency: NonEmptyString100.orThrow(currency),
      unit: NonEmptyString100.orThrow(unit.trim()),
    };
    const outcome = await runWrite(
      existing
        ? repository.update(existing.id, columns)
        : repository.insert({
            id: createId<"Listing">(),
            createdAtSec: PositiveInt.orThrow(nowSeconds()),
            ...columns,
          }),
    );
    setIsSaving(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    reportAppLog({
      tag: existing ? "listings.edited" : "listings.added",
      summary: `Listing ${existing ? "edited" : "added"}: ${side}`,
      payload: { side, currency },
    });
    back();
  };

  const remove = async () => {
    if (!existing) return;
    setIsSaving(true);
    const outcome = await runWrite(repository.remove(existing.id));
    setIsSaving(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    reportAppLog({
      tag: "listings.removed",
      summary: "Listing removed",
      payload: {},
    });
    back();
  };

  return (
    <Stack gap="$lg">
      <SegmentedControl
        accessibilityLabel={t("listingSide")}
        value={side}
        options={LISTING_SIDES.map((value) => ({
          value,
          label: t(SIDE_KEYS[value]),
        }))}
        onValueChange={setSide}
      />
      <TextField
        label={t("listingTitle")}
        hideLabel
        placeholder={t("listingTitlePlaceholder")}
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        testID="listing-title"
      />
      <Row gap="$sm" alignItems="flex-start">
        <Stack flex={1} minWidth={0}>
          <TextField
            label={t("listingPrice")}
            hideLabel
            placeholder={t("listingPrice")}
            inputMode="decimal"
            value={amount}
            onChangeText={setAmount}
            trailing={
              <Button
                variant="ghost"
                size="sm"
                onPress={nextCurrency}
                disabled={currencyChoices.length < 2}
                tooltip={t("listingCurrency")}
                aria-label={`${t("listingCurrency")}: ${listingCurrencyLabel(currency, lang)}`}
                testID="listing-currency"
              >
                {listingCurrencyLabel(currency, lang)}
              </Button>
            }
            testID="listing-amount"
          />
        </Stack>
        <Stack flex={1} minWidth={0}>
          <TextField
            label={t("listingUnit")}
            hideLabel
            placeholder={t("listingUnitPlaceholder")}
            value={unit}
            onChangeText={setUnit}
            maxLength={40}
            testID="listing-unit"
          />
        </Stack>
      </Row>
      {error ? (
        <Text variant="caption" color="$dangerText">
          {error}
        </Text>
      ) : null}
      <Button
        icon="Check"
        disabled={!canSave || isSaving}
        loading={isSaving}
        onPress={() => void save()}
        testID="listing-save"
      >
        {t(existing ? "listingSave" : "listingAdd")}
      </Button>
      {existing ? (
        <Button
          variant="ghost"
          icon="Trash2"
          disabled={isSaving}
          onPress={() => void remove()}
        >
          {t("listingRemove")}
        </Button>
      ) : null}
    </Stack>
  );
}
