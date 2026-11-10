// Emergency password reset, e.g. when the only administrator is locked out.
// Stop the app first (Ctrl+C), then run:  npm run reset-password -- <username> <new-password>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.error('Usage: npm run reset-password -- <username> <new-password (at least 8 characters)>');
  process.exit(1);
}
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// The password is stored as a plain one-way hash here; ATLAS encrypts it with its key at the next
// sign-in or start (so this script never needs the key, wherever the app keeps it).
const db = openDb(process.env.DB_FILE || path.join(root, 'data', 'db.json'));
const user = db.data.users.find((u) => u.username === username.toLowerCase());
if (!user) {
  console.error(`No account named "${username}".`);
  process.exit(1);
}
user.passwordHash = hashPassword(password);
if (user.status === 'disabled') user.status = 'active';
user.mustChangePassword = true;
db.save();
console.log(`Password for "${user.username}" was reset. They will be asked to choose a new one when they sign in.`);
