import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((value) => value === 'true');
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optionalSecret = z.string().default('');
const price = z.object({ input: z.number().positive(), output: z.number().positive() }).strict();
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine((v) => /^postgres(ql)?:/.test(v)),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: optionalSecret,
  ADMIN_API_KEY: z.string().min(32).refine((v) => !v.startsWith('replace-with'), 'Replace the example admin key'),
  TIMEZONE: z.string().default('Asia/Kolkata').refine((v) => {
    try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
  }, 'Invalid IANA timezone'),
  CLIENT_AGENT_ENABLED: bool.default('false'),
  RESEARCH_AGENT_ENABLED: bool.default('false'),
  CLIENT_AGENT_DAILY_LEAD_LIMIT: z.coerce.number().int().min(1).max(20).default(6),
  CLIENT_AGENT_TIME: clock.default('09:00'),
  CLIENT_REGIONS: z.string().default('Delhi,Gurugram,Noida,Faridabad,Ghaziabad'),
  CLIENT_CATEGORIES: z.string().default('Salons and beauty parlours,Gyms and fitness studios,Cafes and restaurants,Photographers/videographers,Event planners and decorators,Interior designers,Coaching/training institutes,Local boutiques/fashion stores,Bakeries,Yoga/fitness instructors,Home-service businesses,Small local agencies/service businesses'),
  RESEARCH_CYCLE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  RESEARCH_START_TIME: clock.default('13:00'),
  RESEARCH_END_TIME: clock.default('17:00'),
  RESEARCH_BATCH_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(240).default(30),
  OPENAI_ENABLED: bool.default('false'),
  TAVILY_ENABLED: bool.default('false'),
  TAVILY_API_KEY: optionalSecret,
  TAVILY_MAX_RESULTS_PER_QUERY: z.coerce.number().int().min(1).max(10).default(5),
  TAVILY_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  TAVILY_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
  TAVILY_DAILY_CREDIT_LIMIT: z.coerce.number().int().min(1).default(30),
  TAVILY_MONTHLY_CREDIT_LIMIT: z.coerce.number().int().min(1).default(900),
  TAVILY_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(20),
  CLIENT_DISCOVERY_QUERIES: z.coerce.number().int().min(1).max(10).default(3),
  CLIENT_DISCOVERY_CANDIDATES: z.coerce.number().int().min(1).max(20).default(8),
  CLIENT_REVIEW_ENABLED: bool.default('true'),
  CLIENT_ENRICHMENT_EXTRACTS: z.coerce.number().int().min(0).max(5).default(2),
  RESEARCH_TAVILY_QUERIES: z.coerce.number().int().min(1).max(5).default(1),
  RESEARCH_TAVILY_EXTRACTS: z.coerce.number().int().min(0).max(5).default(1),
  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL_SMALL: optionalSecret,
  OPENAI_MODEL_STRONG: optionalSecret,
  OPENAI_MODEL_PRICES: z.string().default('{}').transform((value, ctx) => {
    try { return z.record(price).parse(JSON.parse(value)); }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected model-to-price JSON mapping' }); return z.NEVER; }
  }),
  OPENAI_DAILY_BUDGET_USD: z.coerce.number().positive().default(2),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(30),
  OPENAI_DISABLE_NONESSENTIAL_AT_95: bool.default('true'),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(16000).default(2000),
  OPENAI_FINAL_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1000).max(32000).default(12000),
  TELEGRAM_ENABLED: bool.default('false'),
  TELEGRAM_BOT_TOKEN: optionalSecret,
  CLIENT_TELEGRAM_BOT_TOKEN: optionalSecret,
  RESEARCH_TELEGRAM_BOT_TOKEN: optionalSecret,
  CLIENT_TELEGRAM_CHAT_ID: optionalSecret,
  RESEARCH_TELEGRAM_CHAT_ID: optionalSecret,
  CLIENT_TELEGRAM_WEBHOOK_SECRET: optionalSecret,
  RESEARCH_TELEGRAM_WEBHOOK_SECRET: optionalSecret,
  TELEGRAM_CHAT_ID: optionalSecret,
  TELEGRAM_WEBHOOK_SECRET: z.string().default('').refine((v) => v === '' || /^[A-Za-z0-9_-]{32,256}$/.test(v), 'Use 32-256 letters, digits, underscores or hyphens'),
  HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
}).superRefine((env, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (env.TAVILY_ENABLED && !env.TAVILY_API_KEY) issue('TAVILY_API_KEY', 'Required when enabled');
  if (env.RESEARCH_START_TIME >= env.RESEARCH_END_TIME) issue('RESEARCH_END_TIME', 'Must be later than start on the same day');
  if (env.OPENAI_ENABLED) {
    if (!env.OPENAI_API_KEY) issue('OPENAI_API_KEY', 'Required when enabled');
    for (const key of ['OPENAI_MODEL_SMALL', 'OPENAI_MODEL_STRONG'] as const) {
      if (!env[key] || !env.OPENAI_MODEL_PRICES[env[key]]) issue(key, 'Model and explicit pricing required');
    }
  }
  if (env.TELEGRAM_ENABLED) {
    if (env.CLIENT_TELEGRAM_BOT_TOKEN || env.RESEARCH_TELEGRAM_BOT_TOKEN) {
      for (const agent of ['CLIENT', 'RESEARCH'] as const) {
        if (!/^\d+:[A-Za-z0-9_-]+$/.test(env[`${agent}_TELEGRAM_BOT_TOKEN`])) issue(`${agent}_TELEGRAM_BOT_TOKEN`, 'Valid bot token required for both agents');
        if (!/^-?\d+$/.test(env[`${agent}_TELEGRAM_CHAT_ID`] || env.TELEGRAM_CHAT_ID)) issue(`${agent}_TELEGRAM_CHAT_ID`, 'Set a numeric agent chat ID or shared TELEGRAM_CHAT_ID');
      }
    } else {
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN)) issue('TELEGRAM_BOT_TOKEN', 'Valid bot token required');
      if (!/^-?\d+$/.test(env.TELEGRAM_CHAT_ID)) issue('TELEGRAM_CHAT_ID', 'Numeric operator chat ID required');
    }
  }
  for (const agent of ['CLIENT', 'RESEARCH'] as const) {
    const secret = env[`${agent}_TELEGRAM_WEBHOOK_SECRET`];
    if (secret && !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) issue(`${agent}_TELEGRAM_WEBHOOK_SECRET`, 'Use 32-256 letters, digits, underscores or hyphens');
  }
  if (env.CLIENT_TELEGRAM_WEBHOOK_SECRET && env.CLIENT_TELEGRAM_WEBHOOK_SECRET === env.RESEARCH_TELEGRAM_WEBHOOK_SECRET) issue('RESEARCH_TELEGRAM_WEBHOOK_SECRET', 'Use distinct secrets for the two bot webhooks');
  // Fail closed while the actual workflows are pending; never silently pretend to run.
  if (env.RESEARCH_AGENT_ENABLED && (!env.OPENAI_ENABLED || !env.TELEGRAM_ENABLED)) issue('RESEARCH_AGENT_ENABLED', 'Scheduled research agent requires OpenAI and Telegram');
  if (env.CLIENT_AGENT_ENABLED && (!env.OPENAI_ENABLED || !env.TELEGRAM_ENABLED)) issue('CLIENT_AGENT_ENABLED', 'Scheduled client agent requires OpenAI and Telegram');
});

export type Environment = z.infer<typeof environmentSchema>;
export function validateEnvironment(input: Record<string, unknown>): Environment {
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    // Field names and schema messages only: never include environment values.
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}
