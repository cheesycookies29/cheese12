// Gives the Windows executable the CORE icon and version details (Properties > Details).
// Usage: node set-resources.mjs <exe> <icon.ico> <version> <resedit module dir>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [exe, iconFile, version, toolsDir] = process.argv.slice(2);
const ResEdit = await import(pathToFileURL(path.join(toolsDir, 'node_modules', 'resedit', 'dist', 'index.js')).href);

const exeData = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exeData);

const iconFileData = ResEdit.Data.IconFile.from(fs.readFileSync(iconFile));
const existing = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const groupId = existing[0]?.id ?? 1;
const lang = existing[0]?.lang ?? 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFileData.icons.map((i) => i.data));

const [major, minor, patch] = version.replace(/-.*/, '').split('.').map(Number);
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
vi.setFileVersion(major, minor, patch, 0, 1033);
vi.setProductVersion(major, minor, patch, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  CompanyName: 'Lancaster Technology and Development Corporation',
  FileDescription: 'CORE - ERP by Lancaster',
  ProductName: 'CORE - ERP by Lancaster',
  InternalName: 'CORE-ERP',
  OriginalFilename: 'CORE-ERP.exe',
  LegalCopyright: `(c) ${new Date().getFullYear()} Lancaster Technology and Development Corporation`,
  FileVersion: version,
  ProductVersion: version,
});
vi.outputToResourceEntries(res.entries);

res.outputResource(exeData);
fs.writeFileSync(exe, Buffer.from(exeData.generate()));
console.log(`Set icon and version ${version} on ${path.basename(exe)}`);
