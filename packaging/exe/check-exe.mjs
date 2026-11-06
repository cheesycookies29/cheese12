// Checks a built CORE-ERP.exe: the app is embedded byte for byte, the single-executable fuse is
// switched on, and the icon and version details are there. Exits non-zero if anything is off.
// Usage: node check-exe.mjs <exe> <sea.blob> <tools dir>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [exe, blobFile, toolsDir] = process.argv.slice(2);
const ResEdit = await import(pathToFileURL(path.join(toolsDir, 'node_modules', 'resedit', 'dist', 'index.js')).href);
const data = fs.readFileSync(exe);
const res = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(data, { ignoreCert: true }));
const problems = [];

const blob = fs.readFileSync(blobFile);
const embedded = res.entries.find((e) => e.type === 10 && String(e.id).toUpperCase() === 'NODE_SEA_BLOB');
if (!embedded) problems.push('the app (NODE_SEA_BLOB) is not embedded');
else if (!Buffer.from(embedded.bin).equals(blob)) problems.push('the embedded app differs from the built one');
if (!data.includes(Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1'))) problems.push('the single-executable fuse is not switched on');
if (!ResEdit.Resource.IconGroupEntry.fromEntries(res.entries).length) problems.push('no icon');
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const product = vi?.getStringValues({ lang: 1033, codepage: 1200 })?.ProductName;
if (!product?.startsWith('CORE')) problems.push(`version details missing (ProductName: ${product})`);

if (problems.length) {
  console.error(`check-exe: ${problems.join('; ')}`);
  process.exit(1);
}
console.log(`check-exe: OK (app ${(blob.length / 1024 / 1024).toFixed(1)} MB embedded, fuse on, icon and "${product}" details set)`);
