// Create the first Administrator from the command line instead of the admin panel's
// first-run page, e.g. on a cloud server before it is reachable from the internet.
// Stop the app first, then run:  npm run create-admin -- <username> "<Full Name>"
// A temporary password is printed; it must be changed at first sign-in.
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const [rawUsername, ...nameParts] = process.argv.slice(2);
const username = String(rawUsername || '').trim().toLowerCase();
const name = nameParts.join(' ').trim();
if (!/^[a-z0-9._-]{3,40}$/.test(username) || !name) {
  console.error('Usage: npm run create-admin -- <username> "<Full Name>"');
  process.exit(1);
}
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = openDb(process.env.DB_FILE || path.join(root, 'data', 'db.json'));
if (db.data.users.some((u) => u.role === 'admin')) {
  console.error('An administrator already exists. To regain access, use: npm run reset-password -- <username> <new-password>');
  process.exit(1);
}
if (db.data.users.some((u) => u.username === username)) {
  console.error(`The username "${username}" is taken.`);
  process.exit(1);
}
const password = randomBytes(9).toString('base64url');
db.data.users.push({
  id: randomUUID(), username, name, email: '', role: 'admin', status: 'active',
  mustChangePassword: true, passwordHash: hashPassword(password), createdAt: new Date().toISOString(),
});
db.save();
console.log(`Administrator "${username}" created.`);
console.log(`Temporary password: ${password}`);
console.log('Sign in at /admin with it; you will be asked to choose a new password.');
