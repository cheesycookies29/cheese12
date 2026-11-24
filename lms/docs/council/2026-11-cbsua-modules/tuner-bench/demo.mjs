import { memoryDb } from '/home/user/cheese12/lms/server/db.js';
import { setPasswordCost } from '/home/user/cheese12/lms/server/auth.js';
import { addDemo } from '/home/user/cheese12/lms/server/demo.js';
import { addFinanceDemo } from '/home/user/cheese12/lms/server/finance-demo.js';
import { createApi } from '/home/user/cheese12/lms/server/api.js';
import fs from 'node:fs';
setPasswordCost(10);
const db = memoryDb();
const api = createApi(db, { clock: () => new Date('2026-08-10T10:00:00'), sealAtStart:false });
// emulate ctx minimal for finance demo via route invoke is hard; call addDemo only + try finance
addDemo(db.data, '2026-08-10', null);
const json = JSON.stringify(db.data, null, 2);
fs.writeFileSync(process.argv[2], json);
const rows = Object.entries(db.data).filter(([k,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length, Buffer.byteLength(JSON.stringify(v))]).sort((a,b)=>b[2]-a[2]);
console.log('total bytes (pretty)', json.length, 'compact', JSON.stringify(db.data).length);
for (const r of rows.slice(0,25)) console.log(r.join('\t'));
