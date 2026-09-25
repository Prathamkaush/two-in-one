import { z } from 'zod';
import { factorsSchema, weightsSchema } from './scoring/scoring';
import { publicUrl } from '../common/security/public-http';
const url = z.string().max(2048).url().refine((v) => { try { publicUrl(v); return true; } catch { return false; } }, 'Public HTTPS URL required');
export const candidateSchema = z.object({
  businessName: z.string().min(2).max(200), category: z.string().min(1).max(100), location: z.string().min(1).max(100),
  websiteUrl: url.nullable(), instagramUrl: url.refine((v) => ['instagram.com', 'www.instagram.com'].includes(new URL(v).hostname)).nullable(),
  socialUrls: z.array(url).max(5).default([]),
  sourceUrl: url, verifiedAt: z.string().datetime(),
  facts: z.array(z.object({ claim: z.string().min(3).max(500), sourceUrl: url })).min(1).max(20),
  factors: factorsSchema,
}).strict().superRefine((v, ctx) => {
  if (!v.instagramUrl && !v.socialUrls.length) ctx.addIssue({ code: 'custom', message: 'A public social profile is required' });
  if (v.websiteUrl && v.factors.noWebsite) ctx.addIssue({ code: 'custom', message: 'A known website conflicts with noWebsite evidence' });
  if (new Date(v.verifiedAt).getTime() > Date.now()) ctx.addIssue({ code: 'custom', message: 'Verification date cannot be in the future' });
});
export const marketSchema = z.object({ regions: z.array(z.string().min(1).max(100)).min(1).max(100),
  categories: z.array(z.string().min(1).max(100)).min(1).max(100), dailyLimit: z.number().int().min(1).max(20),
  weights: weightsSchema, minimumScore: z.number().min(0).max(100) }).strict();
export type Candidate = z.infer<typeof candidateSchema>;
