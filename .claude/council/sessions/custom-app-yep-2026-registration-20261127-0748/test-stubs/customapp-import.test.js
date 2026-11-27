// BDD stubs for `test/customapp-import.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-008: Guest import with collision report', () => {
  // AC-047 (integration-test) → test/customapp-import.test.js
  it('GIVEN a CSV and an XLSX with aliased headers WHEN POST .../import previews and POST .../import/:jobId/apply applies THEN the preview changes nothing and the apply is one commit', () => {
    throw new Error('Not implemented — AC-047 pending');
  });
  // AC-048 (unit-test) → test/customapp-import.test.js
  it('GIVEN surnames with diacritics, spaces, hyphens, apostrophes and Jr./III and mobiles +63 917 123 4567, 09171234567 and 917-123-4567 WHEN they are normalised THEN the surname canon follows R2 and every mobile gives last 4 = 4567', () => {
    throw new Error('Not implemented — AC-048 pending');
  });
  // AC-049 (unit-test) → test/customapp-import.test.js
  it('GIVEN a list with two guests sharing surname and last 4, a guest with no mobile and no email, a likely duplicate, an unknown industry and a table above capacity WHEN previewed THEN the collision report counts each kind', () => {
    throw new Error('Not implemented — AC-049 pending');
  });
  // AC-050 (unit-test) → test/customapp-import.test.js
  it('GIVEN names containing CR/LF and control characters and cells starting with = + - @, tab or CR WHEN imported and exported THEN the characters are stripped on import and the cells are prefixed with \' on export', () => {
    throw new Error('Not implemented — AC-050 pending');
  });
  // AC-051 (integration-test) → test/customapp-import.test.js
  it('GIVEN a 2.5 MB file, a 2,500-row file and a non-Super-Administrator caller WHEN they import THEN each is refused', () => {
    throw new Error('Not implemented — AC-051 pending');
  });
  // AC-052 (unit-test) → test/customapp-import.test.js
  it('GIVEN a live event with checked-in, seated and owned guests WHEN the same list is re-imported with changes THEN it merges by externalKey and never touches status, seat or owner, and a second identical import changes nothing', () => {
    throw new Error('Not implemented — AC-052 pending');
  });
});
