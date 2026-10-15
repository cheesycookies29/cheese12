// Which build of the app is running: build.json written by the installers
// (update.sh, the Windows package), otherwise the git checkout it runs from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const startedAt = new Date().toISOString();

function fromGit() {
  const git = path.join(ROOT, '.git');
  const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
  if (!head.startsWith('ref: ')) return { commit: head, branch: null };
  const ref = head.slice(5);
  const loose = path.join(git, ref);
  const commit = fs.existsSync(loose)
    ? fs.readFileSync(loose, 'utf8').trim()
    : fs.readFileSync(path.join(git, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0];
  return { commit: commit || null, branch: ref.replace('refs/heads/', '') };
}

export function buildInfo() {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'build.json'), 'utf8'));
    return { commit: b.commit || null, installedAt: b.installedAt || null, channel: b.channel || 'installed', startedAt };
  } catch {}
  try {
    const { commit, branch } = fromGit();
    return { commit, installedAt: null, channel: branch ? `source (${branch})` : 'source', startedAt };
  } catch {}
  return { commit: null, installedAt: null, channel: 'unknown', startedAt };
}
