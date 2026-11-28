// Fetch one hour's off-server copy for a restore (0.38; steps in deploy/aws/RESTORE.md):
//   node scripts/offsite-fetch.js hourly/2026-11-18/09 /tmp/restore
//   node scripts/offsite-fetch.js hourly/2026-12-09/19/20 /tmp/restore   (a 15-minute copy on an event day)
// Writes db.json, the audit log and its head, and every attached file into the folder, using the
// server's role (ltdc-erp-server). Nothing in the running CORE is changed.
import { fetchOffsiteCopy } from '../server/offsite.js';

const [prefix, dest] = process.argv.slice(2);
if (!prefix || !dest) {
  console.error('Usage: node scripts/offsite-fetch.js hourly/YYYY-MM-DD/HH[/MM] <folder>');
  process.exit(2);
}
try {
  const r = await fetchOffsiteCopy({ prefix, dest });
  console.log(`Fetched ${r.files.join(', ')} and ${r.attachments} attached files into ${dest}.`);
} catch (err) {
  console.error(`Could not fetch the copy: ${err.message}`);
  process.exit(1);
}
