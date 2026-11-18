// Hourly off-server backup (0.38): copies the data file, the audit log and new attached files to
// the server's S3 bucket (server/offsite.js). Run by cron on the AWS server:
//   node scripts/offsite-backup.js            (data folder: ./data, or DATA_DIR)
// Exit code 1 when the copy failed; the reason is in data/backups/offsite.json and the Security monitor.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOffsiteBackup } from '../server/offsite.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
const s = await runOffsiteBackup({ dataDir });
console.log(s.ok ? `Copied to s3://${s.bucket}/${s.prefix}/ (${s.files.map((f) => f.name).join(', ')}; ${s.attachments.new} new attached files) in ${s.ms} ms.` : `Off-server backup failed: ${s.error}`);
process.exit(s.ok ? 0 : 1);
