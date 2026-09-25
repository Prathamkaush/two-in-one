import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Settings } from '../src/common/config/settings.service';
import { AdminGuard } from '../src/common/security/admin.guard';
import { redact } from '../src/common/logging/safe-logger';
const settings = new Settings(new ConfigService({ ADMIN_API_KEY: 'a'.repeat(32) }));
const context = (authorization?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }) }) as ExecutionContext;
describe('security', () => {
  it('requires a valid bearer token', () => {
    const guard = new AdminGuard(settings);
    expect(() => guard.canActivate(context())).toThrow();
    expect(() => guard.canActivate(context('Bearer invalid'))).toThrow();
    expect(guard.canActivate(context(`Bearer ${'a'.repeat(32)}`))).toBe(true);
  });
  it('redacts credentials from transport errors', () => {
    expect(redact(new Error('https://api.telegram.org/bot123:ABC/sendMessage sk-testsecret Bearer abc'))).not.toMatch(/ABC|testsecret|Bearer abc/);
    expect(redact('postgresql://user:password@host/db')).not.toContain('password');
  });
});
