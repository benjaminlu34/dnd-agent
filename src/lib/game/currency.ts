import { z } from "zod";
import type { CurrencyDenominations, PromptCurrencySummary } from "@/lib/game/types";

export const COPPER_PER_SILVER = 10;
export const COPPER_PER_GOLD = 100;
export const COPPER_PER_PLATINUM = 10_000;

export const currencyDenominationsSchema: z.ZodType<CurrencyDenominations> = z.object({
  cp: z.number().int().optional(),
  sp: z.number().int().optional(),
  gp: z.number().int().optional(),
  pp: z.number().int().optional(),
}).refine((data) => {
  const values = Object.values(data).filter((value): value is number => value !== undefined && value !== 0);
  if (values.length === 0) {
    return false;
  }
  const isPositive = values[0] > 0;
  return values.every((value) => (value > 0) === isPositive);
}, {
  message: "Currency denominations must not be empty or zero, and all non-zero values must share the same sign.",
});

export function flattenCurrencyToCp(currency: CurrencyDenominations): number {
  return (currency.cp ?? 0)
    + ((currency.sp ?? 0) * COPPER_PER_SILVER)
    + ((currency.gp ?? 0) * COPPER_PER_GOLD)
    + ((currency.pp ?? 0) * COPPER_PER_PLATINUM);
}

export function formatCurrency(totalCp: number): string {
  const sign = totalCp < 0 ? "-" : "";
  let remaining = Math.abs(totalCp);
  const pp = Math.floor(remaining / COPPER_PER_PLATINUM);
  remaining %= COPPER_PER_PLATINUM;
  const gp = Math.floor(remaining / COPPER_PER_GOLD);
  remaining %= COPPER_PER_GOLD;
  const sp = Math.floor(remaining / COPPER_PER_SILVER);
  remaining %= COPPER_PER_SILVER;
  const cp = remaining;

  const parts = [
    pp ? `${pp} pp` : null,
    gp ? `${gp} gp` : null,
    sp ? `${sp} sp` : null,
    cp ? `${cp} cp` : null,
  ].filter(Boolean);

  if (!parts.length) {
    return "0 cp";
  }

  return `${sign}${parts.join(", ")}`;
}

export function formatCurrencyCompact(totalCp: number): string {
  return formatCurrency(totalCp);
}

export function toPromptCurrencySummary(totalCp: number): PromptCurrencySummary {
  return {
    totalCp,
    formatted: formatCurrencyCompact(totalCp),
  };
}

