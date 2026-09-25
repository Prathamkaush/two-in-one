try { process.loadEnvFile(); } catch { /* environment may already be supplied */ }
async function main() {
  const base = 'http://127.0.0.1:3000';
  const headers = { authorization: `Bearer ${process.env.ADMIN_API_KEY}` };
  for (const [path, expected, auth] of [
    ['/health/live', 200, false], ['/health/ready', 200, false],
    ['/admin/status', 401, false], ['/admin/status', 200, true],
    ['/admin/queues', 200, true], ['/admin/client/configuration', 200, true],
    ['/admin/research/cycles', 200, true],
  ]) {
    const response = await fetch(base + path, { headers: auth ? headers : {}, signal: AbortSignal.timeout(5000) });
    if (response.status !== expected) throw new Error(`${path}: expected ${expected}, received ${response.status}`);
    console.log(`PASS ${path} (${expected}${auth ? ', authenticated' : ''})`);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
