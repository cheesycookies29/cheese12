// PDF Studio (0.64): what the browser and the server agree on. The limits, and the kinds of files
// it takes (the browser checks the name first; the server checks what the file holds).
export const PDF_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024, // one upload
  maxSources: 40, // files in PDF Studio at a time, per person
  maxStoredBytes: 300 * 1024 * 1024, // all of a person's files together
  maxPages: 1000, // pages of one file (an export may have twice as many)
  sourceHours: 4, // a file not used for this long is deleted
};
// Taken as they are by the server.
export const PDF_DIRECT_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'txt', 'md', 'markdown', 'csv', 'html', 'htm'];
// Pictures the browser turns into PNG first (what it can show, it can convert).
export const PDF_BROWSER_IMAGES = ['webp', 'gif', 'bmp', 'avif', 'svg', 'heic', 'heif', 'tif', 'tiff', 'ico'];
export const PDF_ACCEPT = [...PDF_DIRECT_EXTS, ...PDF_BROWSER_IMAGES].map((e) => `.${e}`).join(',');
export const PDF_SIZES = { a4: 'A4', letter: 'Letter', legal: 'Legal (long)', a5: 'A5' };
// Kinds of file, for the icon tag on each source.
export const PDF_KIND_TAG = { pdf: ['PDF', 'red'], image: ['IMG', 'teal'], docx: ['DOC', 'blue'], odt: ['ODT', 'blue'], xlsx: ['XLS', 'green'], ods: ['ODS', 'green'], csv: ['CSV', 'green'], pptx: ['PPT', 'orange'], odp: ['ODP', 'orange'], txt: ['TXT', 'gray'], md: ['MD', 'gray'], html: ['HTML', 'gray'] };
