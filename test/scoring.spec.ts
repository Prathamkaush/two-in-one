import { defaultWeights, scoreLead, LeadFactors } from '../src/client-agent/scoring/scoring';
import { publicAddress, publicUrl } from '../src/common/security/public-http';
const good: LeadFactors = { noWebsite: true, poorWebsite: false, activeSocial: true, clearOffering: true, recentActivity: true, operatingEvidence: true, weakContact: true, serviceFit: true };
describe('lead scoring', () => {
  it('prioritizes no website opportunities', () => {
    expect(scoreLead(good, defaultWeights)).toBe(100);
    expect(scoreLead({ ...good, noWebsite: false, poorWebsite: true }, defaultWeights)).toBe(85);
  });
  it('does not double count incompatible website factors', () => expect(scoreLead({ ...good, poorWebsite: true }, defaultWeights)).toBe(100));
  it('supports configurable weights and rejects negatives', () => {
    expect(scoreLead({ ...good, noWebsite: false }, { ...defaultWeights, noWebsite: 70 })).toBe(50);
    expect(() => scoreLead(good, { ...defaultWeights, noWebsite: -1 })).toThrow();
  });
});
describe('public HTTP restrictions', () => {
  it.each(['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '0.0.0.0'])('blocks %s', (ip) => expect(publicAddress(ip)).toBe(false));
  it.each(['http://example.com', 'https://localhost', 'https://user:pass@example.com', 'https://example.com:3000', 'https://127.0.0.1'])('rejects %s', (url) => expect(() => publicUrl(url)).toThrow());
  it('allows a public HTTPS URL', () => expect(publicUrl('https://example.com/a').hostname).toBe('example.com'));
});
