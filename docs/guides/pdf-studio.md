---
id: pdf-studio
title: Making PDFs with PDF Studio
summary: For everyone: turn Word, Excel, PowerPoint, OpenDocument, text, CSV and pictures into PDF, put PDFs together, arrange, turn and remove pages, and export with page numbers, a header, a footer or a watermark.
roles: admin, hr, hrstaff, payroll, it, support, sales, salesmgr, pm, employee
apps: pdf, home
order: 15
---

## Before you start

**PDF Studio** is a tool on the CORE home, under **Tools**. Anyone signed in can use it, whatever their account type, while it is on for the company (an administrator turns it on or off under **Admin panel → Modules**).

It takes:

- **PDFs**: their pages as they are.
- **Pictures**: JPEG and PNG; WebP, GIF, BMP and other pictures your browser can show are converted in your browser first. Each picture becomes a page.
- **Documents**: Word (.docx), Excel (.xlsx), PowerPoint (.pptx), OpenDocument (.odt, .ods, .odp), text (.txt), Markdown (.md), CSV and HTML files. CORE lays their text, headings, lists, tables and pictures out on pages, in its own plain style: they will not look exactly as in Word or Excel, but nothing is left out except what a PDF page cannot hold (fonts, colours of cells, charts, drawings, animations).

Older Office files (.doc, .xls, .ppt) and password-protected PDFs are not taken: save them in the newer format, or without the password, first. Each file can be up to 25 MB.

Your files are yours only: nobody else sees them, not even administrators. They are deleted after 4 hours without use, when you click **Start over**, and whenever CORE restarts. Each export is in the audit log (how many pages, from how many files, and the file name), never what is in it.

## Walkthrough

1. Open the **CORE home** and, under **Tools**, click **PDF Studio**.
2. Drag a few files from your computer onto the page, or click **choose files**. Each one is converted as it arrives (*Converting report.docx…*), then its pages appear under **Pages** and the file under **Files**.
3. In **Pages**, every page of every file is a card, in one row: the first page of a picture or a scanned PDF shows the picture itself; a typed page shows its first words. Drag a card to another place, or use its arrows. **Turn left** and **Turn right** turn it; the bin removes it from the PDF (the file stays under **Files**, with **Add all pages** to put its pages back).
4. Tick several cards to change them together: turn them, move them **To the start** or **To the end**, or **Remove** them.
5. On the right, under **Export**, give the file a name, choose **One PDF**, and click **Download PDF**. **Preview** opens it in a new tab first.

![PDF Studio with three files and their pages](pdf-studio.jpg)

## How to…

### Put several PDFs together

Add them all, put the pages in the order you want (drag a whole group: tick its pages, then drag one of them), and click **Download PDF**. Pages keep their own size and content; only their order and turn change.

### Turn a Word, Excel or PowerPoint file into a PDF

Add the file. A Word document keeps its headings, paragraphs, bold and italic, lists, tables, links and pictures; an Excel workbook becomes one table per sheet (hidden sheets are left out; a sheet of more than 2,000 rows keeps the first 2,000), with dates and percentages as they are shown; a PowerPoint presentation becomes one landscape page per slide, with its title, text, tables and pictures. A note under the file says what could not go in (for example *2 pictures in a format a PDF cannot hold were left out*).

### Change the page size, margins or text size

Click **Page setup** above the files. Choose the **Page size** (A4, Letter, Legal (long) or A5; for pictures also **Picture size**), the **Orientation** (*As the file suits* turns wide sheets, slides and pictures to landscape), the **Margins** in millimetres, the **Text size** of documents, and how **Pictures** fill their page. Tick **Also lay out again…** to apply it to the files already added, or apply it to one file with the gear on its row. PDFs keep their own pages.

### Remove, turn or reorder pages

Use the buttons on each card, or tick several and use the bar above the pages. **Reverse** puts the last page first (for a stack scanned back to front); **Blank page** adds an empty page at the end, to drag where you need it.

### Add page numbers, a header or a footer

Under **Export**, open **Page numbers, header and footer**. Tick **Number the pages** and choose the style (*1*, *Page 1 of 9*, *1 / 9*), where they go, the first number, and whether the first page (a cover) is left unnumbered. A **Header** and a **Footer** can use {page}, {pages}, {title}, {date} and {file}, for example *Confidential · {date}*. They are drawn on every page, upright even on a page you turned.

### Mark every page with a watermark

Open **Watermark** and type the text (*DRAFT*, *CONFIDENTIAL*, *COPY*). It goes across each page, in grey, red or blue, as strong as you set it.

### Get one PDF per file or per page

Under **Save as**, choose **One PDF per file (ZIP)** or **One PDF per page (ZIP)**, then **Download ZIP**. Each PDF in the ZIP is named after its file (or numbered by page), with its own page numbers.

### Start over

Click **Start over** at the top: every file and page goes from PDF Studio (download what you need first).

## Screens at a glance

| Screen | What it is for |
|---|---|
| PDF Studio | Add files (drop or choose); **Files**: each file with its kind, size and pages, its **Page setup** and remove; **Pages**: every page as a card to drag, turn or remove, with **Select all**, **Blank page** and **Reverse**; **Export**: the file name, one PDF or a ZIP, page numbers, header and footer, watermark, document details, **Download** and **Preview** |
| CORE home | **Tools**: the card that opens PDF Studio |

## Questions

**Why does my Word document look different in the PDF?**
CORE lays the text out itself, in a standard font, with the document's headings, lists, tables and pictures, but not its fonts, colours of cells, text boxes, shapes or charts. For an exact copy, use **Save as PDF** in Word and add that PDF here.

**Why was a picture in my document left out?**
Only JPEG and PNG pictures can go into the PDF here. Pictures saved as EMF or WMF (common for charts and logos in Office) are left out, and the file's note says how many.

**Why is a page's preview only lines?**
CORE shows the picture of a page only for pictures and scanned pages. A typed page shows its first words. Use **Preview** to see the whole PDF.

**Can someone else see my files?**
No. Each person sees only their own files, and they are deleted after 4 hours without use. Administrators see in the audit log that you exported a PDF (how many pages, the file name), never its contents.

**Why is PDF Studio not on my CORE home?**
An administrator turned it off for the company, under **Admin panel → Modules**.
