type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

export function formatDailyReport(agent: string, date: string, value: unknown) {
  const report = object(value), discovery = object(report.discovery);
  if (agent === 'CLIENT') {
    const rejected = Object.values(object(discovery.rejections)).reduce<number>((sum, n) => sum + count(n), 0);
    return [
      'CLIENT FINDER — DAILY SUMMARY', date, '',
      `Qualified leads: ${count(report.selectedCount)}`,
      `Needs your review: ${count(report.reviewCount)}`,
      `Candidates saved: ${count(report.candidateCount)}`, '',
      'Discovery checks',
      `Businesses examined: ${count(discovery.extractedCandidates)}`,
      `Rejected during discovery: ${rejected}`,
      `Duplicates skipped: ${count(discovery.duplicates)}`,
      `Website unknown: ${count(discovery.uncertainWebsites)}`,
      `Recent activity unverified: ${count(discovery.missingRecentActivity)}`,
      `Discovery errors: ${count(discovery.errors)}`,
      `Verification steps failed: ${count(discovery.enrichmentFailures)}`, '',
      count(report.reviewCount) ? 'Next: send /client_reviews for pending cards. Check bio links, website and recent posts before contacting anyone. Counts above reflect the original run; rejected/contacted cards are excluded.' :
        count(report.selectedCount) ? 'Next: review the lead cards and outreach drafts before sending.' : 'No leads ready today. Check discovery results before another run.',
      'Unknown website does not mean no website. No businesses were contacted.',
    ].join('\n');
  }
  const sources = Object.entries(object(report.sources)).slice(0, 10).map(([name, n]) => `${name.slice(0, 80)}: ${count(n)}`);
  return ['RESEARCH — DAILY SUMMARY', date, '', `Cycle day: ${count(report.day)}`,
    `Items examined: ${count(report.totalItemsExamined)}`, `Processed: ${count(report.processed)}`,
    `Pending: ${count(report.pending)}`, `Duplicates: ${count(report.duplicates)}`,
    '', 'Sources', ...sources, '',
    `Schedule: ${typeof report.nextCollectionWindow === 'string' ? report.nextCollectionWindow.slice(0, 200) : 'Not recorded'}`,
    'Collection report only; final recommendations follow the research cycle.'].join('\n');
}
