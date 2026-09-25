import { ConsoleLogger } from '@nestjs/common';

export function redact(value: unknown): string {
  let text = value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(KEY|TOKEN|PASSWORD|SECRET|DATABASE_URL)/i.test(key) && secret && secret.length >= 4) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  return text
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .slice(0, 2000);
}

export class SafeLogger extends ConsoleLogger {
  override log(message: unknown, ...args: unknown[]) { super.log(redact(message), ...args.map(redact)); }
  override error(message: unknown, ...args: unknown[]) { super.error(redact(message), ...args.map(redact)); }
  override warn(message: unknown, ...args: unknown[]) { super.warn(redact(message), ...args.map(redact)); }
  override debug(message: unknown, ...args: unknown[]) { super.debug(redact(message), ...args.map(redact)); }
  override verbose(message: unknown, ...args: unknown[]) { super.verbose(redact(message), ...args.map(redact)); }
  override fatal(message: unknown, ...args: unknown[]) { super.fatal(redact(message), ...args.map(redact)); }
}
