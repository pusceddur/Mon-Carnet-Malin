import { z } from 'zod';
import { ColorHexSchema, IdSchema, MillisSchema, PageIndexSchema, Sha256HexSchema } from './common';

export const InkToolSchema = z.enum(['pencil', 'pen', 'highlighter']);
export const EraserModeSchema = z.enum(['stroke', 'partial', 'page']);
export const ThicknessSchema = z.enum(['fin', 'moyen', 'epais']);

export const InkPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  p: z.number().min(0).max(1),
});

export const InkSpaceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    pageIndex: PageIndexSchema,
    blockIndex: z.number().int().nonnegative(),
    charOffset: z.number().int().nonnegative(),
    blockTextHash: Sha256HexSchema,
    contextText: z.string().max(500),
    endAnchor: z
      .object({
        blockIndex: z.number().int().nonnegative(),
        charOffset: z.number().int().nonnegative(),
      })
      .nullable(),
  }),
  z.object({
    kind: z.literal('original'),
    pageIndex: PageIndexSchema,
  }),
  z.object({
    kind: z.literal('answer'),
    exerciseId: IdSchema,
    questionId: z.string().min(1).max(64),
  }),
]);

export const InkAnnotationSchema = z.object({
  id: IdSchema,
  type: z.literal('ink'),
  childId: IdSchema,
  documentId: IdSchema.nullable(),
  tool: InkToolSchema,
  color: ColorHexSchema,
  width: z.number().positive(),
  opacity: z.number().min(0).max(1),
  space: InkSpaceSchema,
  points: z.array(InkPointSchema).max(20000),
  createdAt: MillisSchema,
  updatedAt: MillisSchema,
  deletedAt: MillisSchema.nullable(),
});

export const TextHighlightSchema = z.object({
  id: IdSchema,
  type: z.literal('highlight'),
  childId: IdSchema,
  documentId: IdSchema,
  color: ColorHexSchema,
  pageIndex: PageIndexSchema,
  blockIndex: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  blockTextHash: Sha256HexSchema,
  text: z.string().max(20000),
  createdAt: MillisSchema,
  updatedAt: MillisSchema,
  deletedAt: MillisSchema.nullable(),
});

export const TEXT_BOX_MAX_CHARS = 2000;
export const TEXT_BOX_FONT_SIZE = { min: 0.012, max: 0.08, default: 0.022 } as const;

export const TextBoxAnnotationSchema = z.object({
  id: IdSchema,
  type: z.literal('textbox'),
  childId: IdSchema,
  documentId: IdSchema,
  pageIndex: PageIndexSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.02).max(1),
  fontSize: z.number().min(TEXT_BOX_FONT_SIZE.min).max(TEXT_BOX_FONT_SIZE.max),
  color: ColorHexSchema,
  text: z.string().max(TEXT_BOX_MAX_CHARS),
  createdAt: MillisSchema,
  updatedAt: MillisSchema,
  deletedAt: MillisSchema.nullable(),
});

export const AnnotationSchema = z.discriminatedUnion('type', [InkAnnotationSchema, TextHighlightSchema, TextBoxAnnotationSchema]);
