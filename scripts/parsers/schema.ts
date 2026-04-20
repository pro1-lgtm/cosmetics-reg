import { z } from "zod";

export const RegulationStatus = z.enum([
  "banned",
  "restricted",
  "allowed",
  "listed",
  "not_listed",
]);
export type RegulationStatus = z.infer<typeof RegulationStatus>;

export const ExtractedRegulation = z.object({
  inci_name: z.string().min(1),
  korean_name: z.string().nullable().default(null),
  chinese_name: z.string().nullable().default(null),
  japanese_name: z.string().nullable().default(null),
  cas_no: z.string().nullable().default(null),
  synonyms: z.array(z.string()).default([]),
  status: RegulationStatus,
  max_concentration: z.number().nullable().default(null),
  concentration_unit: z.string().default("%"),
  product_categories: z.array(z.string()).default([]),
  conditions: z.string().nullable().default(null),
  source_section: z.string().nullable().default(null),
});
export type ExtractedRegulation = z.infer<typeof ExtractedRegulation>;

export const ExtractionOutput = z.object({
  regulations: z.array(ExtractedRegulation).default([]),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;

// Gemini responseSchema shape (not Zod — the Gemini SDK uses a JSON-schema subset)
export const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    regulations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          inci_name: { type: "string" },
          korean_name: { type: "string", nullable: true },
          chinese_name: { type: "string", nullable: true },
          japanese_name: { type: "string", nullable: true },
          cas_no: { type: "string", nullable: true },
          synonyms: { type: "array", items: { type: "string" } },
          status: {
            type: "string",
            enum: ["banned", "restricted", "allowed", "listed", "not_listed"],
          },
          max_concentration: { type: "number", nullable: true },
          concentration_unit: { type: "string" },
          product_categories: { type: "array", items: { type: "string" } },
          conditions: { type: "string", nullable: true },
          source_section: { type: "string", nullable: true },
        },
        required: ["inci_name", "status"],
      },
    },
  },
  required: ["regulations"],
} as const;
