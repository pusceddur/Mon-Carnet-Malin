import { z } from 'zod';

export const IdSchema = z.string().min(1).max(36);
export const MillisSchema = z.number().int().nonnegative();
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const ColorHexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const PageIndexSchema = z.number().int().nonnegative().max(10000);
export const QuestionTypeSchema = z.enum(['qcm', 'vrai_faux', 'reponse_libre', 'association', 'ordre']);
