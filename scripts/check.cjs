const { spawnSync } = require('node:child_process');
const commands = [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['node_modules/eslint/bin/eslint.js', 'src', 'test'],
  ['node_modules/jest/bin/jest.js', '--runInBand'],
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
];
for (const args of commands) {
  console.log(`Checking: ${args.join(' ')}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
