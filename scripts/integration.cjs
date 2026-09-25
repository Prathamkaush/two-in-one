const { PrismaClient } = require('@prisma/client');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
try { process.loadEnvFile(); } catch { /* CI supplies environment directly. */ }
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const admin = new PrismaClient();
  const name = `automation_test_${randomBytes(8).toString('hex')}`;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  try {
    const env = { ...process.env, DATABASE_URL: url.toString(), INTEGRATION_TEST_DATABASE: name, NODE_ENV: 'test' };
    for (const args of [
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      ['node_modules/jest/bin/jest.js', '--config', 'jest.integration.config.cjs', '--runInBand'],
    ]) {
      const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
      if (result.status !== 0) { process.exitCode = result.status || 1; break; }
    }
  } finally {
    // The generated database belongs exclusively to this test run.
    if (!/^automation_test_[a-f0-9]{16}$/.test(name)) throw new Error('Invalid test database name');
    await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}
main().catch(() => { console.error('Integration setup failed; check local PostgreSQL/Redis and database-create permissions.'); process.exitCode = 1; });
