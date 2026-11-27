// PDF Studio (0.66): the "compound file" (MS-CFB) of the older Office formats (.doc, .xls, .ppt),
// Outlook messages (.msg) and password-protected Office files. The reader is the file checks' own
// (server/dms/cfb.js); here its refusals become PDF Studio's read errors.
//
//   readCfb(buffer) → { names, storages, has(path), size(path), read(path) }
import { fail } from './office-core.js';
import { readCfb as readCompound, CfbError } from '../dms/cfb.js';

export { CFB_SIGNATURE, isCompound } from '../dms/cfb.js';

const asReadError = (run) => {
  try {
    return run();
  } catch (err) {
    if (err instanceof CfbError) fail(err.message);
    throw err;
  }
};

export function readCfb(buffer, options) {
  const cfb = asReadError(() => readCompound(buffer, options));
  return { ...cfb, read: (name) => asReadError(() => cfb.read(name)) };
}
