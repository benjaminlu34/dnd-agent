import { z } from "zod";
import type { CurrencyProfile, PromptCurrencySummary } from "@/lib/game/types";

export const COPPER_PER_SILVER = 10;
export const COPPER_PER_GOLD = 100;
export const COPPER_PER_PLATINUM = 10_000;
export const baseCurrencyDeltaSchema = z.coerce.number().int();
const legacyCurrencyDenominationsSchema = z.object({
  cp: z.number().int().optional(),
  sp: z.number().int().optional(),
  gp: z.number().int().optional(),
  pp: z.number().int().optional(),
});

export const currencyDenominationsSchema = z.union([
  baseCurrencyDeltaSchema,
  legacyCurrencyDenominationsSchema,
]);

export const defaultCurrencyProfile: CurrencyProfile = {
  unitName: "copper piece",
  unitLabel: "Copper Pieces",
  shortLabel: "cp",
  precision: 0,
};

export function formatCurrency(totalBaseUnits: number, profile: CurrencyProfile = defaultCurrencyProfile): string {
  const sign = totalBaseUnits < 0 ? "-" : "";
  const magnitude = Math.abs(totalBaseUnits);
  const precision = profile.precision ?? 0;
  const divisor = precision > 0 ? 10 ** precision : 1;
  const rendered =
    precision > 0
      ? (magnitude / divisor).toFixed(precision)
      : String(magnitude);

  return `${sign}${rendered} ${profile.shortLabel}`;
}

export function formatCurrencyCompact(totalBaseUnits: number, profile: CurrencyProfile = defaultCurrencyProfile): string {
  return formatCurrency(totalBaseUnits, profile);
}

export function flattenCurrencyToCp(value: number | { cp?: number; sp?: number; gp?: number; pp?: number }) {
  if (typeof value === "number") {
    return value;
  }

  return (value.cp ?? 0)
    + ((value.sp ?? 0) * COPPER_PER_SILVER)
    + ((value.gp ?? 0) * COPPER_PER_GOLD)
    + ((value.pp ?? 0) * COPPER_PER_PLATINUM);
}

export function toPromptCurrencySummary(
  totalBaseUnits: number,
  profile: CurrencyProfile = defaultCurrencyProfile,
): PromptCurrencySummary {
  return {
    totalBaseUnits,
    formatted: formatCurrencyCompact(totalBaseUnits, profile),
    unitLabel: profile.unitLabel,
    shortLabel: profile.shortLabel,
    totalCp: totalBaseUnits,
  };
}
