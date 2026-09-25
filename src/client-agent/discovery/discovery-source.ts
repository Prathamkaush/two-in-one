import { Candidate } from '../client.schemas';
export interface BusinessEvidence {
  candidate: Candidate;
  provenance: { provider: string; query: string; verificationQuery: string; collectedAt: string; sourceUrls: string[] };
}
export interface DiscoveryResult {
  businesses: BusinessEvidence[];
  queries: string[];
  errors: number;
  duplicates: number;
  uncertainWebsites: number;
}
export interface BusinessDiscoverySource {
  readonly name: string;
  discover(input: { date: string; regions: string[]; categories: string[] }): Promise<DiscoveryResult>;
}
