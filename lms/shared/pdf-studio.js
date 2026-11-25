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
  maxConvertPages: 300, // pages of an export to Word, text, a spreadsheet or SVG (0.68)
  maxPicturePages: 100, // pages of an export to PNG or JPEG pictures, drawn by the browser (0.68)
};
// What the export makes (0.68). PDF is the PDF itself; the others are read back from it
// (server/pdf/convert.js). PNG and JPEG pictures are drawn by the browser from the server's SVG.
export const PDF_EXPORT_FORMATS = {
  pdf: { label: 'PDF', ext: 'pdf', group: 'PDF', hint: 'The pages exactly as they are, with page numbers, header, footer and watermark if you add them.' },
  docx: { label: 'Word', ext: 'docx', group: 'Document to edit', hint: 'Text, headings, tables and pictures, to go on working on in Word or Google Docs.' },
  odt: { label: 'OpenDocument text', ext: 'odt', group: 'Document to edit', hint: 'The same as Word, for LibreOffice.' },
  rtf: { label: 'Rich Text', ext: 'rtf', group: 'Document to edit', hint: 'Opens in almost any word processor.' },
  html: { label: 'Web page', ext: 'html', group: 'Document to edit', hint: 'One web page, pictures inside.' },
  md: { label: 'Markdown', ext: 'md', group: 'Document to edit', hint: 'Text with headings and tables marked; pictures beside it in a ZIP.' },
  txt: { label: 'Plain text', ext: 'txt', group: 'Document to edit', hint: 'The words only.' },
  xlsx: { label: 'Excel', ext: 'xlsx', group: 'Spreadsheet', hint: 'Every line a row, text that lines up in columns in columns, numbers as numbers. A sheet a page.' },
  csv: { label: 'CSV', ext: 'csv', group: 'Spreadsheet', hint: 'The same rows and columns, as CSV.' },
  png: { label: 'PNG pictures', ext: 'png', group: 'Pictures of the pages', hint: 'A picture of each page, sharp text.', browser: true },
  jpg: { label: 'JPEG pictures', ext: 'jpg', group: 'Pictures of the pages', hint: 'A picture of each page, smaller files (photos, scans).', browser: true },
  svg: { label: 'SVG pictures', ext: 'svg', group: 'Pictures of the pages', hint: 'Each page as a drawing that stays sharp at any size.' },
};
// Picture sharpness for PNG and JPEG: dots per inch.
export const PDF_PICTURE_DPI = [72, 150, 300];
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
