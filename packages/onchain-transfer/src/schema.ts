import { OnchainTransferId } from "@linky-fit/domain";
import { Schema } from "effect";

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
export const NonNegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
);
export const BasisPoints = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 10_000 }),
);
export const NonEmptyText = (maxLength: number) =>
  Schema.String.check(Schema.isBetweenLength(1, maxLength));

export const OnchainTransferIdString = Schema.String.pipe(
  Schema.refine(OnchainTransferId.is),
);
