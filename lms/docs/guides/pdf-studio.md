---
id: pdf-studio
title: Making PDFs with PDF Studio
summary: For the school's employees: turn Word, Excel, PowerPoint, OpenDocument, text, CSV and pictures into PDF, put PDFs together, arrange, turn and remove pages, change and add text, sign, and export with page numbers, a header, a footer or a watermark; export as PDF, Word, OpenDocument, Rich Text, a web page, Markdown, text, Excel, CSV or pictures of the pages; check that a signed PDF is unchanged.
roles: admin, registrar, dean, teacher, hr, payroll, accountant, budget, cashier, supply, approver, staff
apps: tools, home
order: 15
---

## Before you start

**PDF Studio** is in **ATLAS Tools**: open it from its card under **Tools** on the ATLAS home page (**Open PDF Studio**), or from the **Systems** menu (the grid in the top bar) in any system. It is for the school's employees (teachers, registrars, deans, HR, payroll, Finance offices and staff) and administrators. An administrator chooses which account types may use it, under **Admin panel → Home page & systems → Tools**; students and parents get it only if the school switches it on for them.

To try it with the demo school, sign in as `teacher.demo` (password `demo1234`), Maria Santos.

It takes:

- **PDFs**: their pages as they are, with what was filled in or stamped on them (form answers, stamps, comments shown on the page) drawn into the page. A PDF protected with a password asks for it (see [Add a protected PDF](#add-a-protected-pdf)); one that only stops printing or copying is added without asking.
- **Pictures**: JPEG, PNG and TIFF (scans of several pages too, each page a page). WebP, GIF, BMP, HEIC and other pictures your browser can show are converted in your browser first. Each picture becomes a page.
- **Documents**: Word (.docx, .doc, .rtf, templates and files with macros; the macros are never run), Excel (.xlsx, .xls), PowerPoint (.pptx, .ppt), OpenDocument (.odt, .ods, .odp), text (.txt), Markdown (.md), CSV and TSV, and HTML files. ATLAS lays their text, headings, lists, tables and pictures out on pages, in its own plain style: they will not look exactly as in Word or Excel, but nothing is left out except what a PDF page cannot hold (fonts, colours of cells, charts, drawings, animations).
- **Code, data and logs**: .json, .xml, .sql, .log, .yaml, .py, .js and other text files, in a fixed-width font (JSON saved on one line is laid out to be read).
- **E-books and e-mails**: EPUB e-books without DRM (each chapter on a new page), and e-mails saved from your mail program (.eml, or .msg from Outlook): the subject, who sent it to whom and when, the message and its pictures; other attachments are named.
- **ZIPs**: every file inside that PDF Studio takes is added, in name order; the note under the upload names the ones that were not.

Each file can be up to 100 MB (2,000 pages). Large files are sent in pieces, with a progress bar; if your connection drops for a moment, the piece is sent again by itself. All your files together can be up to 600 MB, and one export can take pages from up to 400 MB of files.

Your files are yours only: nobody else sees them, not even administrators. They are deleted after 4 hours without use, when you choose **Start over**, and whenever ATLAS restarts. Each export is in the audit log (how many pages, from how many files, and the file name), never what is in it.

## Walkthrough

1. Sign in on the ATLAS home page and, under **Tools**, choose **PDF Studio**.
2. Drag a few files from your computer onto the page, or choose **choose files**. Each one is converted as it arrives (*Converting report.docx…*), then its pages appear under **Pages** and the file under **Files**.
3. In **Pages**, every page of every file is a card, in one row: the first page of a picture or a scanned PDF shows the picture itself; a typed page shows its first words. Drag a card to another place, or use its arrows. **Turn left** and **Turn right** turn it; the bin removes it from the PDF (the file stays under **Files**, with **Add all pages** to put its pages back).
4. Tick several cards to change them together: turn them, move them **To the start** or **To the end**, or **Remove** them.
5. Choose the pencil on a page (or double-click it) to open the **page editor**: change its text, add text, white-out, highlights, ticks, today's date, a picture or your signature. **Sign**, above the pages, opens it ready to sign.
6. On the right, under **Export**, give the file a name, choose **One PDF**, and choose **Download PDF**. **Preview** opens it in a new tab first. To get something other than a PDF (a Word file to edit, an Excel sheet, pictures of the pages), choose it under **Format** first.

![PDF Studio with three files and their pages](pdf-studio.jpg)

![The page editor, with a line of text being changed](pdf-studio-editor.jpg)

## How to…

### Put several PDFs together

Add them all, put the pages in the order you want (drag a whole group: tick its pages, then drag one of them), and choose **Download PDF**. Pages keep their own size and content; only their order and turn change.

### Turn a Word, Excel or PowerPoint file into a PDF

Add the file. A Word document keeps its headings, paragraphs, bold and italic, lists, tables, links and pictures; an Excel workbook becomes one table per sheet (hidden sheets are left out; a sheet of more than 2,000 rows keeps the first 2,000), with numbers, amounts, dates, times and percentages as Excel shows them (*₱1,234.50*, *15/03/2026*, *12%*); a PowerPoint presentation becomes one landscape page per slide, with its title, text, tables and pictures. A note under the file says what could not go in (for example *2 pictures in a format a PDF cannot hold were left out*).

### Change the page size, margins or text size

Choose **Page setup** above the files. Choose the **Page size** (A4, Letter, Legal (long) or A5; for pictures also **Picture size**), the **Orientation** (*As the file suits* turns wide sheets, slides and pictures to landscape), the **Margins** in millimetres, the **Text size** of documents, and how **Pictures** fill their page. Tick **Also lay out again…** to apply it to the files already added, or apply it to one file with the gear on its row. PDFs keep their own pages. Pages laid out again keep their place in **Pages** and their turn; what you added in the page editor stays, but changes to the text of a page laid out again are dropped (its lines are new), and ATLAS says so.

### Remove, turn or reorder pages

Use the buttons on each card, or tick several and use the bar above the pages. Turning a page you changed in the page editor turns what you added with it, so it stays on the same words; signatures, pictures and text stay upright. **Reverse** puts the last page first (for a stack scanned back to front); **Blank page** adds an empty page at the end, to drag where you need it.

### Add page numbers, a header or a footer

Under **Export**, open **Page numbers, header and footer**. Tick **Number the pages** and choose the style (*1*, *Page 1 of 9*, *1 / 9*), where they go, the first number, and whether the first page (a cover) is left unnumbered. A **Header** and a **Footer** can use {page}, {pages}, {title}, {date} and {file}, for example *Confidential · {date}*. They are drawn on every page, upright even on a page you turned.

### Mark every page with a watermark

Open **Watermark** and type the text (*DRAFT*, *CONFIDENTIAL*, *COPY*). It goes across each page, in grey, red or blue, as strong as you set it.

### Get one PDF per file or per page

Under **Save as**, choose **One PDF per file (ZIP)** or **One PDF per page (ZIP)**, then **Download ZIP**. Each PDF in the ZIP is named after its file (or numbered by page), with its own page numbers.

### Export as Word, Excel, text or pictures

Under **Export**, choose what to make under **Format**, then choose **Download**:

| Format | What you get |
|---|---|
| **PDF** | The pages exactly as they are, with page numbers, header, footer and watermark if you add them |
| **Word** (.docx), **OpenDocument text** (.odt), **Rich Text** (.rtf) | A document to go on working on: the text in paragraphs, larger text as headings, text in columns as tables, and the pictures, one page after another with a page break between them |
| **Web page** (.html) | The same, as one web page with its pictures inside |
| **Markdown** (.md) | The text with its headings, bold and tables marked; with pictures, a ZIP with the pictures beside it |
| **Plain text** (.txt) | The words only |
| **Excel** (.xlsx), **CSV** | Every line a row; text that lines up in columns goes in columns, and numbers (*1,250.00*, *(300.00)*, *15%*) are numbers you can add up. In Excel, each page has its own sheet |
| **PNG pictures**, **JPEG pictures** | A picture of each page, at the **Sharpness** you choose (72 dpi for a screen, 150 for most uses, 300 to print); several pages come in a ZIP. JPEG files are smaller, PNG text is sharper |
| **SVG pictures** | Each page as a drawing that stays sharp at any size |

Everything you did in PDF Studio goes in: the order of the pages, turned pages, text you changed or added, white-out, ticks and signatures. **Save as** works for documents too: one file, one per file, or one per page in a ZIP.

Good to know:

- A PDF keeps how its pages look, not how its document was made, so ATLAS reads the text back from the pages: check the result, especially tables and columns. For the original Word or Excel file, ask whoever made the PDF.
- A scanned page is a picture: in Word, OpenDocument, Rich Text, a web page and Markdown it is the picture of the page; in text and spreadsheets it is left empty. ATLAS says so when you download. A scan whose text was recognised (you can select its words in a PDF reader) gives its text.
- Page numbers, header, footer and watermark go on PDFs and pictures, not into documents to edit. Only a PDF gets a signature record page.
- Up to 300 pages at a time for documents, spreadsheets and SVG, and 100 for PNG and JPEG (your browser draws them, so a large export at 300 dpi takes a moment).

![Export with Format set to Word](pdf-studio-export-formats.jpg)

### Change the text on a page

1. Open the page in the editor (the pencil on its card) and choose **Change text on the page**. Each line of the page's text is outlined in blue.
2. Choose the line to change, and type the new words in the panel on the right. Change the **Size**, the **Font** (*Sans*, *Serif* or *Fixed*), **Bold**, **Italic** or the **Colour** if you need to.
3. Choose **Done**. In the PDF, the old words are taken out of the page itself (they cannot be found or copied any more) and the new ones are written where the old ones began.

The new words are in a standard font close to the original (Helvetica, Times or Courier), so they may look a little different from the rest of the page. These fonts have the letters of Western European languages: a character they do not have (for example Chinese, Greek or some symbols) is written as **?**, and ATLAS warns you when you export. A line drawn inside a picture or a drawing on the page cannot be changed (it is outlined in dots): cover it with **White-out** and use **Add text**. A scanned page is a picture: it has no lines of text to change.

### Add text, white-out, highlights, ticks and dates

In the page editor:

- **Add text**: choose where it begins, then type it on the right; drag its corner to make it wrap.
- **White-out**: drag over what to hide. A white box covers it, but whatever is under it stays in the file: to take text out, use **Change text on the page**.
- **Highlight**: drag over the words.
- **Tick** and **Cross**: choose where they go; **Today's date**: choose where it goes (you can edit it afterwards).
- **Picture**: pick a picture (a logo, a stamp), then choose where it goes.

On a phone or tablet, swipe to move around the page and tap where things go; with **White-out** and **Highlight** a swipe draws, so choose **Select and move** to scroll again.

**Select and move** picks anything you added: drag it to move it, drag its corner to resize it, press **Delete** to remove it, use the arrow keys to nudge it. **Undo** (or Ctrl+Z) goes back a step. The arrows at the top go to the previous or next page. A card with changes shows how many; a signed page shows **Signed**.

### Sign a PDF

1. Choose **Sign** above the pages (or **Signature** in the page editor).
2. **Draw** your signature with the mouse, a finger or a pen; or **Type** your name and pick a style; or **Upload** a picture of your signature (ATLAS makes the paper around it see-through). Tick **Remember it in this browser** to find it under **Saved** next time.
3. Choose **Use this signature**, then choose the place on the page where it goes. Drag its corner to size it. Sign other pages the same way.
4. Export as **One PDF**. With **Add a signature record page** ticked (it is, unless you untick it), ATLAS adds a last page saying who signed, when, on which pages, and a record code such as *ATLAS-7KQ2-M9XA*, and keeps a fingerprint of the file.

This is a signature drawn on the page, with ATLAS's record of who signed and of the file as it was. It is not a digital certificate signature that PDF readers check by themselves.

### Verify a signed PDF

Choose **Verify a signed PDF** at the top and choose the file. ATLAS compares it with the record it kept when it was signed:

- **Unchanged since it was signed**: the same file, with who signed it and when.
- **This file was changed after it was signed**: it names a record, but its contents are not the ones that were signed (even one changed character shows). Ask the signer for the original.
- Otherwise, it was not signed in this ATLAS's PDF Studio, or its record page was taken out.

### Add a protected PDF

Add it like any other file. If it needs a password to open, PDF Studio asks for it: type it and choose **Open** (or **Skip this file**). ATLAS uses the password once, to read the file, and does not keep it. PDF Studio works with an unprotected copy of its pages, and the PDF you export is not protected: keep it as safe as the original.

A PDF that only stops printing or copying (many statements and forms) is added without asking. A PDF protected with a certificate cannot be opened here: save an unprotected copy in the program that opens it.

### Add many files at once

Select them all, or put them in a ZIP and add that: every file in it that PDF Studio takes is added, in name order (folders included). While large files upload, a bar shows how far each one is.

### Start over

Choose **Start over** at the top: every file and page goes from PDF Studio (download what you need first).

## Screens at a glance

| Screen | What it is for |
|---|---|
| PDF Studio | Add files (drop or choose); **Files**: each file with its kind, size and pages, its **Page setup** and remove; **Pages**: every page as a card to drag, turn, edit or remove, with **Select all**, **Sign**, **Blank page** and **Reverse**; **Export**: the file name, the **Format** (PDF, Word, OpenDocument, Rich Text, web page, Markdown, text, Excel, CSV, PNG, JPEG or SVG), one file or a ZIP, page numbers, header and footer, watermark, document details, the signature record page, **Download** and **Preview**; **Verify a signed PDF** |
| Page editor | One page at a time: **Change text on the page**, **Add text**, **White-out**, **Highlight**, **Tick**, **Cross**, **Today's date**, **Signature**, **Picture**; the panel on the right for what is selected; **Undo**, the previous and next page, **Done** |
| ATLAS home | **Tools**: the PDF Studio card (a small tile in **Compact**) that opens it (also in the **Systems** menu of every system) |
| Admin panel → Home page & systems | **Tools**: the account types that may use PDF Studio (administrators) |

## Questions

**Why does my Word document look different in the PDF?**
ATLAS lays the text out itself, in a standard font, with the document's headings, lists, tables and pictures, but not its fonts, colours of cells, text boxes, shapes or charts. For an exact copy, use **Save as PDF** in Word and add that PDF here.

**Why was a picture in my document left out?**
Only JPEG and PNG pictures can go into the PDF here. Pictures saved as EMF or WMF (common for charts and logos in Office) are left out, and the file's note says how many.

**Why is a character shown as "?" in my PDF?**
The text ATLAS writes (page numbers, header, footer, watermark, the text you add or change) uses the standard PDF fonts, which have the letters of Western European languages only. Characters they do not have become **?**, and ATLAS tells you which. Documents you add keep theirs only as far as these fonts go too: for other scripts, make the PDF in the program that made the document and add that PDF here.

**Why is part of a page a grey box?**
That part is a picture in a format browsers cannot show (JPEG 2000 or JBIG2, used by some scanners); the page editor says so. It is only how PDF Studio shows it: the picture stays as it is in the PDF you download (use **Preview** to see it).

**Why does a page look slightly different in PDF Studio than in my PDF reader?**
ATLAS draws each page itself, with the fonts of your browser in place of the PDF's own, so the letters can differ a little (the words and their places are the same). Use **Preview** to see the PDF exactly as it will be.

**Is a signature made here legally binding?**
It is a signature you place on the document, with ATLAS's record of who signed, when, and of the file as it was signed. Whether that is enough for a given document is for the school's offices and its legal counsel to say; documents that need a digital certificate signature need one from a certificate provider.

**Why are the paragraphs or tables in my Word file not quite right?**
A PDF only says where each word goes on the page. ATLAS joins lines into paragraphs, finds headings by their size and tables by text that lines up in columns, which works for most reports, letters and forms. Pages with text in several columns, text boxes or text drawn as shapes can come out in a different order. If you have the original document, use it.

**Can someone else see my files?**
No. Each person sees only their own files, and they are deleted after 4 hours without use. Administrators see in the audit log that you exported a PDF (how many pages, the file name), never its contents.

**Why is PDF Studio not on my ATLAS home?**
It is not switched on for your account type (ATLAS says *PDF Studio is not switched on for your account type* if you open its address). Ask an administrator: they choose who may use it under **Admin panel → Home page & systems → Tools**. Students and parents do not have it unless the school switches it on for them.
