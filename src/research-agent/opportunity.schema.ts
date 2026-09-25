import { z } from 'zod';
const dimensions = z.object({ demandEvidence: z.number(), problemSeverity: z.number(), frequency: z.number(), competitiveGap: z.number(),
  willingnessToPay: z.number(), marketDirection: z.number(), monetizationPotential: z.number(), technicalFeasibility: z.number(), distributionFeasibility: z.number(), evidenceQuality: z.number() });
export const opportunitySchema = z.object({ name: z.string(), problem: z.string(), targetCustomer: z.string(), evidence: z.array(z.string()),
  importance: z.string(), demandSignals: z.array(z.string()), competitors: z.array(z.string()), observedGap: z.string(),
  proposedSolution: z.string(), mvp: z.string(), businessModel: z.string(), monetization: z.array(z.string()),
  technicalComplexity: z.string(), mvpComplexity: z.string(), risks: z.array(z.string()), distribution: z.array(z.string()),
  researchRationale: z.string(), sourceReferences: z.array(z.string()), confidence: z.number(), dimensions,
  validationExperiments: z.array(z.string()) });
export const finalReportSchema = z.object({ opportunities: z.array(opportunitySchema), insufficiencyReason: z.string().nullable() });
