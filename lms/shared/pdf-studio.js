// PDF Studio (0.64): what the browser and the server agree on. The limits, and the kinds of files
// it takes (the browser checks the name first; the server checks what the file holds).
export const PDF_LIMITS = {
  maxFileBytes: 100 * 1024 * 1024, // one file (0.66; 25 MB before), sent in chunks
  chunkBytes: 4 * 1024 * 1024, // each piece of an upload (one request each, retried on its own)
  maxSources: 60, // files in PDF Studio at a time, per person
  maxStoredBytes: 600 * 1024 * 1024, // all of a person's files together
  maxPages: 2000, // pages of one file (an export may have twice as many)
  maxExportBytes: 400 * 1024 * 1024, // the files one export takes its pages from, together
  maxArchiveFiles: 60, // files taken from one ZIP
  sourceHours: 4, // a file not used for this long is deleted
};
// Taken by the server, by what each file holds. Office files with macros and templates are read
// as the documents they are (the macros are never run, and are left out).
export const PDF_DOC_EXTS = {
  word: ['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'rtf', 'odt', 'ott'],
  sheet: ['xlsx', 'xlsm', 'xltx', 'xltm', 'xls', 'xlt', 'ods', 'ots', 'csv', 'tsv'],
  slides: ['pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm', 'ppt', 'pps', 'pot', 'odp', 'otp'],
  text: ['txt', 'text', 'md', 'markdown', 'html', 'htm', 'xhtml', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'toml', 'sql', 'js', 'mjs', 'ts', 'py', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rb', 'php', 'sh', 'ps1', 'bat', 'css', 'scss', 'kt', 'swift', 'rs', 'vb', 'r'],
  other: ['epub', 'eml', 'msg', 'zip'],
};
export const PDF_DIRECT_EXTS = ['pdf', 'jpg', 'jpeg', 'jfif', 'png', 'tif', 'tiff', ...Object.values(PDF_DOC_EXTS).flat()];
// Pictures the browser turns into PNG first (what it can show, it can convert).
export const PDF_BROWSER_IMAGES = ['webp', 'gif', 'bmp', 'avif', 'svg', 'heic', 'heif', 'ico'];
export const PDF_ACCEPT = [...PDF_DIRECT_EXTS, ...PDF_BROWSER_IMAGES].map((e) => `.${e}`).join(',');
export const PDF_SIZES = { a4: 'A4', letter: 'Letter', legal: 'Legal (long)', a5: 'A5' };
// Kinds of file, for the icon tag on each source.
export const PDF_KIND_TAG = { pdf: ['PDF', 'red'], image: ['IMG', 'teal'], tiff: ['TIFF', 'teal'], docx: ['DOC', 'blue'], doc: ['DOC', 'blue'], rtf: ['RTF', 'blue'], odt: ['ODT', 'blue'], xlsx: ['XLS', 'green'], xls: ['XLS', 'green'], ods: ['ODS', 'green'], csv: ['CSV', 'green'], pptx: ['PPT', 'orange'], ppt: ['PPT', 'orange'], odp: ['ODP', 'orange'], txt: ['TXT', 'gray'], code: ['CODE', 'gray'], md: ['MD', 'gray'], html: ['HTML', 'gray'], epub: ['EPUB', 'blue'], eml: ['MAIL', 'blue'], msg: ['MAIL', 'blue'] };
