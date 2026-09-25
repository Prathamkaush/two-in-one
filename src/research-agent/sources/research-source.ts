export interface ResearchEvidence {
  sourceUrl: string;
  title: string;
  content: string;
  publishedAt?: Date;
  metadata: Record<string, string | number | boolean>;
}
export interface ResearchSourceAdapter {
  readonly name: string;
  collect(input: { since: Date; limit: number }): Promise<ResearchEvidence[]>;
}
