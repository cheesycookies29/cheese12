// The files a project's tasks and milestones take (0.56): documents people work with, each checked
// by what it holds (server/attachments.js), never by its name alone. No programs, scripts, web pages
// or archives; no macro-enabled Office files. Downloads stay files to save (never opened in CORE).
import { DOCX, XLSX } from './crm.js';

export { DOCX, XLSX };
export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const ODT = 'application/vnd.oasis.opendocument.text';
export const ODS = 'application/vnd.oasis.opendocument.spreadsheet';
export const ODP = 'application/vnd.oasis.opendocument.presentation';
export const TEXT = 'text/plain';
export const CSV = 'text/csv';

export const PM_FILE_TYPES = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image', 'image/png': 'PNG image', 'image/webp': 'WebP image', 'image/gif': 'GIF image',
  [DOCX]: 'Word document', [XLSX]: 'Excel workbook', [PPTX]: 'PowerPoint presentation',
  [ODT]: 'OpenDocument text', [ODS]: 'OpenDocument spreadsheet', [ODP]: 'OpenDocument presentation',
  [TEXT]: 'Text file', [CSV]: 'CSV file',
};
export const MAX_PM_FILE_BYTES = 8 * 1024 * 1024;
// Extensions the file picker offers and the browser checks first (the server checks the contents).
export const PM_FILE_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'txt', 'md', 'csv'];
// Text files are known by their name (.txt, .md, .csv) and by holding readable text.
export const TEXT_EXTS = { txt: TEXT, md: TEXT, csv: CSV };
export const PM_FILE_HINT = 'Add a PDF, a photo (JPEG, PNG, WebP, GIF), a Word, Excel or PowerPoint file (.docx, .xlsx, .pptx), an OpenDocument file (.odt, .ods, .odp), or a text or CSV file, up to 8 MB. Macro-enabled files, programs and archives are not accepted.';
// The tag on a file's icon: its kind, in its colour (pictures and scanned PDFs show a preview).
export function fileTag(type) {
  return ({
    'application/pdf': ['PDF', 'red'], [DOCX]: ['DOC', 'blue'], [ODT]: ['ODT', 'blue'],
    [XLSX]: ['XLS', 'green'], [ODS]: ['ODS', 'green'], [CSV]: ['CSV', 'green'],
    [PPTX]: ['PPT', 'orange'], [ODP]: ['ODP', 'orange'], [TEXT]: ['TXT', 'gray'], 'image/gif': ['GIF', 'gray'],
  })[type] || null;
}
