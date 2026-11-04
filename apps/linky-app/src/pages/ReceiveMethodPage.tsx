import { ListRow, Section } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useAtom } from "@linky-fit/linkstr-react";
import { receiveMethodAtom } from "../app/state/wallet/prefs";
import {
  RECEIVE_METHOD_HINT_KEYS,
  RECEIVE_METHOD_LABEL_KEYS,
  RECEIVE_METHODS,
} from "../utils/receiveMethod";

export function ReceiveMethodPage(): React.ReactElement {
  const { t } = useTranslation();
  const [receiveMethod, setReceiveMethod] = useAtom(receiveMethodAtom);

  return (
    <Section grouped>
      {RECEIVE_METHODS.map((method) => (
        <ListRow
          key={method}
          title={t(RECEIVE_METHOD_LABEL_KEYS[method])}
          description={t(RECEIVE_METHOD_HINT_KEYS[method])}
          selected={receiveMethod === method}
          onPress={() => setReceiveMethod(method)}
          chevron={false}
        />
      ))}
    </Section>
  );
}
