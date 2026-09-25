import { z } from 'zod';
export const factorsSchema = z.object({
  noWebsite: z.boolean(), poorWebsite: z.boolean(), activeSocial: z.boolean(), clearOffering: z.boolean(),
  recentActivity: z.boolean(), operatingEvidence: z.boolean(), weakContact: z.boolean(), serviceFit: z.boolean(),
}).strict();
export const weightsSchema = z.object({ noWebsite: z.number().nonnegative(), poorWebsite: z.number().nonnegative(),
  activeSocial: z.number().nonnegative(), clearOffering: z.number().nonnegative(), recentActivity: z.number().nonnegative(),
  operatingEvidence: z.number().nonnegative(), weakContact: z.number().nonnegative(), serviceFit: z.number().nonnegative() }).strict();
export const defaultWeights = { noWebsite: 30, poorWebsite: 15, activeSocial: 15, clearOffering: 10,
  recentActivity: 10, operatingEvidence: 15, weakContact: 5, serviceFit: 15 };
export type LeadFactors = z.infer<typeof factorsSchema>;
export function scoreLead(factors: LeadFactors, weights: z.infer<typeof weightsSchema>) {
  const safe = weightsSchema.parse(weights);
  const entries = Object.keys(safe) as Array<keyof LeadFactors>;
  // Website opportunity factors are mutually exclusive; normalize to achievable maximum.
  const max = Math.max(safe.noWebsite, safe.poorWebsite) + entries.filter((k) => k !== 'noWebsite' && k !== 'poorWebsite').reduce((n, k) => n + safe[k], 0);
  if (!max) return 0;
  const total = entries.filter((k) => k !== 'poorWebsite' || !factors.noWebsite).reduce((sum, key) => sum + (factors[key] ? safe[key] : 0), 0);
  return Math.round(Math.min(100, total / max * 100));
}
