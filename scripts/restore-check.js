// Daily restore drill (0.38): restores the latest off-server copy (or the newest copy on this
// server) into a throw-away folder and checks CORE works on it (server/restore-check.js).
//   node scripts/restore-check.js             (data folder: ./data, or DATA_DIR)
// Exit code 1 when the check failed; the result is in data/backups/restore-check.json and the Security monitor.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRestoreCheck } from '../server/restore-check.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
const s = await runRestoreCheck({ dataDir });
console.log(s.ok ? `Restore check passed: ${s.copy} opens, ${s.counts.admins} administrator(s), ${s.counts.employees} employees, audit log ${s.audit ? `intact (${s.audit.entries} entries)` : 'not in this copy'}.` : `Restore check FAILED: ${s.error}`);
process.exit(s.ok ? 0 : 1);
