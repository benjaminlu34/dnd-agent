import { z } from "zod";
import type {
  CharacterFramework,
  CharacterFrameworkApproach,
  CharacterFrameworkChoiceMultiFieldDefinition,
  CharacterFrameworkChoiceOption,
  CharacterFrameworkChoiceSingleFieldDefinition,
  CharacterFrameworkFieldDefinition,
  CharacterFrameworkNumericFieldDefinition,
  CharacterFrameworkTextFieldDefinition,
  CharacterFrameworkValue,
  CharacterFrameworkValues,
  CurrencyProfile,
} from "@/lib/game/types";

const optionalTrimmedStringSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  });

const choiceOptionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: optionalTrimmedStringSchema.optional(),
});

const numericFieldSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.literal("numeric"),
  description: optionalTrimmedStringSchema.optional(),
  min: z.number().int(),
  max: z.number().int(),
  defaultValue: z.number().int().optional(),
  maxModifier: z.number().int().nonnegative(),
}).superRefine((field, ctx) => {
  if (field.max < field.min) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max"],
      message: "Numeric field max must be greater than or equal to min.",
    });
  }

  if (field.defaultValue != null && (field.defaultValue < field.min || field.defaultValue > field.max)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultValue"],
      message: "Numeric field defaultValue must fall within min/max bounds.",
    });
  }
});

const choiceSingleFieldSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.literal("choice_single"),
  description: optionalTrimmedStringSchema.optional(),
  options: z.array(choiceOptionSchema).min(1),
  defaultValue: z.string().trim().min(1).nullable().optional(),
}).superRefine((field, ctx) => {
  const optionIds = new Set<string>();

  field.options.forEach((option, index) => {
    if (optionIds.has(option.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options", index, "id"],
        message: "Choice option ids must be unique within a field.",
      });
      return;
    }

    optionIds.add(option.id);
  });

  if (field.defaultValue != null && !optionIds.has(field.defaultValue)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultValue"],
      message: "Choice single defaultValue must reference a defined option id.",
    });
  }
});

const choiceMultiFieldSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.literal("choice_multi"),
  description: optionalTrimmedStringSchema.optional(),
  options: z.array(choiceOptionSchema).min(1),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
  defaultValue: z.array(z.string().trim().min(1)).optional(),
}).superRefine((field, ctx) => {
  const optionIds = new Set<string>();

  field.options.forEach((option, index) => {
    if (optionIds.has(option.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options", index, "id"],
        message: "Choice option ids must be unique within a field.",
      });
      return;
    }

    optionIds.add(option.id);
  });

  if (
    typeof field.minSelections === "number"
    && typeof field.maxSelections === "number"
    && field.maxSelections < field.minSelections
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxSelections"],
      message: "Choice multi maxSelections must be greater than or equal to minSelections.",
    });
  }

  field.defaultValue?.forEach((value, index) => {
    if (!optionIds.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultValue", index],
        message: "Choice multi defaultValue entries must reference defined option ids.",
      });
    }
  });
});

const textFieldSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.literal("text"),
  description: optionalTrimmedStringSchema.optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  multiline: z.boolean().optional(),
  defaultValue: z.string().nullable().optional(),
}).superRefine((field, ctx) => {
  if (
    typeof field.minLength === "number"
    && typeof field.maxLength === "number"
    && field.maxLength < field.minLength
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxLength"],
      message: "Text field maxLength must be greater than or equal to minLength.",
    });
  }
});

export const characterFrameworkFieldSchema = z.discriminatedUnion("type", [
  numericFieldSchema,
  choiceSingleFieldSchema,
  choiceMultiFieldSchema,
  textFieldSchema,
]);

const characterFrameworkApproachSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: optionalTrimmedStringSchema.optional(),
  fieldId: z.string().trim().min(1),
});

const currencyProfileSchema = z.object({
  unitName: z.string().trim().min(1),
  unitLabel: z.string().trim().min(1),
  shortLabel: z.string().trim().min(1),
  precision: z.number().int().nonnegative().optional(),
});

export const characterFrameworkSchema = z.object({
  frameworkVersion: z.string().trim().min(1),
  fields: z.array(characterFrameworkFieldSchema).min(1),
  approaches: z.array(characterFrameworkApproachSchema).min(1),
  baseVitality: z.number().int().positive(),
  vitalityLabel: z.string().trim().min(1),
  currencyProfile: currencyProfileSchema,
  presentationProfile: z.object({
    vitalityLabel: z.string().trim().min(1),
    approachLabel: z.string().trim().min(1),
    conceptLabel: z.string().trim().min(1),
    templateLabel: z.string().trim().min(1),
  }),
}).superRefine((framework, ctx) => {
  const fieldIds = new Set<string>();

  framework.fields.forEach((field, index) => {
    if (fieldIds.has(field.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields", index, "id"],
        message: "Framework field ids must be unique.",
      });
      return;
    }

    fieldIds.add(field.id);
  });

  const numericFieldIds = new Set(
    framework.fields
      .filter((field): field is CharacterFrameworkNumericFieldDefinition => field.type === "numeric")
      .map((field) => field.id),
  );

  const approachIds = new Set<string>();
  framework.approaches.forEach((approach, index) => {
    if (approachIds.has(approach.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approaches", index, "id"],
        message: "Approach ids must be unique.",
      });
      return;
    }

    approachIds.add(approach.id);

    if (!numericFieldIds.has(approach.fieldId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approaches", index, "fieldId"],
        message: "Approaches must target numeric framework field ids.",
      });
    }
  });
});

export type CompiledFrameworkFieldConfig = {
  id: string;
  label: string;
  type: CharacterFrameworkFieldDefinition["type"];
  description: string | null;
  options?: CharacterFrameworkChoiceOption[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  minSelections?: number;
  maxSelections?: number;
  multiline?: boolean;
  defaultValue: CharacterFrameworkValue;
};

export type CompiledCharacterFramework = {
  framework: CharacterFramework;
  valuesSchema: z.ZodType<CharacterFrameworkValues>;
  llmJsonSchema: Record<string, unknown>;
  uiFields: CompiledFrameworkFieldConfig[];
  approaches: CharacterFrameworkApproach[];
  approachIdSchema: z.ZodType<string>;
  approachFieldIds: Record<string, string>;
  fieldMap: Record<string, CharacterFrameworkFieldDefinition>;
  blankValues: CharacterFrameworkValues;
  getModifier(values: CharacterFrameworkValues, approachId: string): number;
  formatCurrency(totalBaseUnits: number): string;
};

function buildFieldValueSchema(field: CharacterFrameworkFieldDefinition) {
  switch (field.type) {
    case "numeric":
      return z.coerce.number().int().min(field.min).max(field.max);
    case "choice_single":
      return z.string().trim().min(1).refine(
        (value) => field.options.some((option) => option.id === value),
        "Value must match one of the defined option ids.",
      );
    case "choice_multi":
      return z.array(z.string().trim().min(1))
        .transform((values) => Array.from(new Set(values)))
        .refine(
          (values) => values.every((value) => field.options.some((option) => option.id === value)),
          "Every value must match one of the defined option ids.",
        )
        .refine(
          (values) => values.length >= (field.minSelections ?? 0),
          `Select at least ${field.minSelections ?? 0} options.`,
        )
        .refine(
          (values) => values.length <= (field.maxSelections ?? field.options.length),
          `Select no more than ${field.maxSelections ?? field.options.length} options.`,
        );
    case "text":
      return z.string()
        .transform((value) => value.trim())
        .refine(
          (value) => value.length >= (field.minLength ?? 0),
          `Enter at least ${field.minLength ?? 0} characters.`,
        )
        .refine(
          (value) => value.length <= (field.maxLength ?? Number.MAX_SAFE_INTEGER),
          `Enter no more than ${field.maxLength ?? Number.MAX_SAFE_INTEGER} characters.`,
        );
  }
}

function defaultValueForField(field: CharacterFrameworkFieldDefinition): CharacterFrameworkValue {
  switch (field.type) {
    case "numeric":
      return field.defaultValue ?? field.min;
    case "choice_single":
      return field.defaultValue ?? field.options[0]?.id ?? null;
    case "choice_multi":
      return field.defaultValue ?? [];
    case "text":
      return field.defaultValue ?? "";
  }
}

function buildApproachIdSchema(approachIds: string[]) {
  const uniqueIds = Array.from(new Set(approachIds));
  return z.string().trim().min(1).refine(
    (value) => uniqueIds.includes(value),
    "Approach id must match one of the module-defined approaches.",
  );
}

function formatCurrencyFromProfile(totalBaseUnits: number, profile: CurrencyProfile) {
  const sign = totalBaseUnits < 0 ? "-" : "";
  const precision = profile.precision ?? 0;
  const magnitude = Math.abs(totalBaseUnits);
  const divisor = precision > 0 ? 10 ** precision : 1;
  const rendered =
    precision > 0
      ? (magnitude / divisor).toFixed(precision)
      : String(magnitude);
  return `${sign}${rendered} ${profile.shortLabel}`;
}

export function compileCharacterFramework(input: CharacterFramework): CompiledCharacterFramework {
  const framework = characterFrameworkSchema.parse(input);
  const fieldMap = Object.fromEntries(framework.fields.map((field) => [field.id, field])) as Record<
    string,
    CharacterFrameworkFieldDefinition
  >;

  const fieldSchemas = Object.fromEntries(
    framework.fields.map((field) => [field.id, buildFieldValueSchema(field)]),
  );
  const valuesSchema = z.object(fieldSchemas).strict();

  const blankValues = Object.fromEntries(
    framework.fields.map((field) => [field.id, defaultValueForField(field)]),
  ) as CharacterFrameworkValues;

  const approachFieldIds = Object.fromEntries(
    framework.approaches.map((approach) => [approach.id, approach.fieldId]),
  );

  return {
    framework,
    valuesSchema,
    llmJsonSchema: z.toJSONSchema(valuesSchema),
    uiFields: framework.fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      description: field.description ?? null,
      options: "options" in field ? [...field.options] : undefined,
      min: field.type === "numeric" ? field.min : undefined,
      max: field.type === "numeric" ? field.max : undefined,
      minLength: field.type === "text" ? field.minLength : undefined,
      maxLength: field.type === "text" ? field.maxLength : undefined,
      minSelections: field.type === "choice_multi" ? field.minSelections : undefined,
      maxSelections: field.type === "choice_multi" ? field.maxSelections : undefined,
      multiline: field.type === "text" ? Boolean(field.multiline) : undefined,
      defaultValue: defaultValueForField(field),
    })),
    approaches: [...framework.approaches],
    approachIdSchema: buildApproachIdSchema(framework.approaches.map((approach) => approach.id)),
    approachFieldIds,
    fieldMap,
    blankValues,
    getModifier(values, approachId) {
      const fieldId = approachFieldIds[approachId];
      if (!fieldId) {
        throw new Error(`Unknown approachId "${approachId}" for framework ${framework.frameworkVersion}.`);
      }

      const parsedValues = valuesSchema.parse(values);
      const resolved = parsedValues[fieldId];
      if (typeof resolved !== "number") {
        throw new Error(`Approach "${approachId}" does not resolve to a numeric field value.`);
      }
      return resolved;
    },
    formatCurrency(totalBaseUnits) {
      return formatCurrencyFromProfile(totalBaseUnits, framework.currencyProfile);
    },
  };
}

export function buildDefaultCharacterFramework(seed = "default"): CharacterFramework {
  return {
    frameworkVersion: `legacy-2d6-${seed}`,
    fields: [
      { id: "force", label: "Force", type: "numeric", min: -2, max: 3, maxModifier: 3, defaultValue: 0 },
      { id: "finesse", label: "Finesse", type: "numeric", min: -2, max: 3, maxModifier: 3, defaultValue: 0 },
      { id: "endure", label: "Endure", type: "numeric", min: -2, max: 3, maxModifier: 3, defaultValue: 0 },
      { id: "analyze", label: "Analyze", type: "numeric", min: -2, max: 3, maxModifier: 3, defaultValue: 0 },
      { id: "notice", label: "Notice", type: "numeric", min: -2, max: 3, maxModifier: 3, defaultValue: 0 },
      { id: "influence", label: "Influence", type: "numeric", min: -2, max: 3, maxModifier: 3, defaultValue: 0 },
    ],
    approaches: [
      { id: "force", label: "Force", fieldId: "force" },
      { id: "finesse", label: "Finesse", fieldId: "finesse" },
      { id: "endure", label: "Endure", fieldId: "endure" },
      { id: "analyze", label: "Analyze", fieldId: "analyze" },
      { id: "notice", label: "Notice", fieldId: "notice" },
      { id: "influence", label: "Influence", fieldId: "influence" },
    ],
    baseVitality: 12,
    vitalityLabel: "Vitality",
    currencyProfile: {
      unitName: "copper piece",
      unitLabel: "Copper Pieces",
      shortLabel: "cp",
      precision: 0,
    },
    presentationProfile: {
      vitalityLabel: "Vitality",
      approachLabel: "Approach",
      conceptLabel: "Concept",
      templateLabel: "Playable Character",
    },
  };
}
