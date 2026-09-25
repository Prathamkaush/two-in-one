import { validateEnvironment } from '../src/common/config/environment';
const base = { DATABASE_URL: 'postgresql://u:p@localhost/db', ADMIN_API_KEY: 'a'.repeat(32) };
describe('configuration', () => {
  it('accepts separate bot tokens with a shared operator chat', () => {
    expect(validateEnvironment({ ...base, TELEGRAM_ENABLED: 'true', CLIENT_TELEGRAM_BOT_TOKEN: '1:client', RESEARCH_TELEGRAM_BOT_TOKEN: '2:research', TELEGRAM_CHAT_ID: '42' }).TELEGRAM_ENABLED).toBe(true);
  });
  it('accepts separate chats without a legacy token or chat', () => {
    expect(validateEnvironment({ ...base, TELEGRAM_ENABLED: 'true', CLIENT_TELEGRAM_BOT_TOKEN: '1:client', RESEARCH_TELEGRAM_BOT_TOKEN: '2:research', CLIENT_TELEGRAM_CHAT_ID: '42', RESEARCH_TELEGRAM_CHAT_ID: '43' }).TELEGRAM_ENABLED).toBe(true);
  });
  it('rejects incomplete split bot configuration and duplicate webhook secrets', () => {
    expect(() => validateEnvironment({ ...base, TELEGRAM_ENABLED: 'true', CLIENT_TELEGRAM_BOT_TOKEN: '1:client', TELEGRAM_CHAT_ID: '42' })).toThrow('RESEARCH_TELEGRAM_BOT_TOKEN');
    expect(() => validateEnvironment({ ...base, CLIENT_TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32), RESEARCH_TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32) })).toThrow('distinct secrets');
  });
  it('starts safely without external API credentials', () => {
    const env = validateEnvironment(base);
    expect(env.OPENAI_ENABLED).toBe(false);
    expect(env.CLIENT_AGENT_ENABLED).toBe(false);
    expect(env.RESEARCH_CYCLE_DAYS).toBe(30);
    expect(env.TAVILY_ENABLED).toBe(false);
  });
  it('requires Tavily credentials and bounds discovery volume when enabled', () => {
    expect(() => validateEnvironment({ ...base, TAVILY_ENABLED: 'true' })).toThrow('TAVILY_API_KEY');
    expect(() => validateEnvironment({ ...base, TAVILY_MAX_RETRIES: '100' })).toThrow('TAVILY_MAX_RETRIES');
    expect(() => validateEnvironment({ ...base, CLIENT_DISCOVERY_CANDIDATES: '1000' })).toThrow('CLIENT_DISCOVERY_CANDIDATES');
  });
  it.each([{ TIMEZONE: 'invalid' }, { RESEARCH_START_TIME: '18:00' }, { RESEARCH_BATCH_INTERVAL_MINUTES: '0' },
    { OPENAI_ENABLED: 'true' }, { TELEGRAM_ENABLED: 'true' }, { ADMIN_API_KEY: 'short' }, { CLIENT_AGENT_ENABLED: 'true' }])('rejects unsafe values %p', (values) => {
    expect(() => validateEnvironment({ ...base, ...values })).toThrow('Invalid configuration');
  });
  it('does not echo secret values in validation errors', () => {
    expect(() => validateEnvironment({ ...base, DATABASE_URL: 'secret-value' })).toThrow(/Invalid configuration/);
    try { validateEnvironment({ ...base, DATABASE_URL: 'secret-value' }); }
    catch (error) { expect(String(error)).not.toContain('secret-value'); }
  });
});
