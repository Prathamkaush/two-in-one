const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const target = path.resolve(__dirname, '../.env');
if (fs.existsSync(target)) {
  const current = fs.readFileSync(target, 'utf8');
  if (/^ADMIN_API_KEY=$/m.test(current)) {
    fs.writeFileSync(target, current.replace(/^ADMIN_API_KEY=$/m, `ADMIN_API_KEY=${randomBytes(32).toString('hex')}`));
    console.log('Generated missing local admin key.');
  } else console.log('.env already exists; left unchanged.');
} else {
  const template = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');
  fs.writeFileSync(target, template.replace('replace-with-a-random-key-at-least-32-characters', randomBytes(32).toString('hex')), { flag: 'wx' });
  console.log('Created .env with a random admin key; external integrations remain disabled.');
}
