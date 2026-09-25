export interface BusinessEvidence {
  externalId: string;
  businessName: string;
  category?: string;
  location?: string;
  websiteUrl?: string;
  instagramUrl?: string;
  sourceUrl: string;
  collectedAt: Date;
  facts: Array<{ claim: string; sourceUrl: string }>;
}
// Provider choice and terms must be confirmed before implementing a live adapter.
export interface BusinessDiscoverySource {
  readonly name: string;
  discover(query: { location: string; categories: string[]; limit: number }): Promise<BusinessEvidence[]>;
}
