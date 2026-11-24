---
id: documents
title: Keeping and sharing documents
summary: For everyone: keep your files in Documents, upload in folders, add versions, check a document out while you change it, share it with people in the company or by a link with someone outside it, collect files through an upload link, and find anything by its title, tags, number or the words inside it.
roles: admin, hr, hrstaff, payroll, it, support, sales, salesmgr, pm, employee
apps: documents, home
order: 16
---

## Before you start

**Document Management** is a module on the CORE home (the folder tile, *Files, versions and secure sharing*). Everyone signed in can use it, whatever their account type, while it is on for the company (an administrator turns it on or off under **Admin panel → Modules**).

Its side menu:

- **My files**: your own folder. Nobody else sees what is in it until you share a document or a folder inside it.
- **Shared with me**: documents and folders other people shared with you, your department or your account type, and the company folders you can open.
- **Recent**: the documents you can open, most recently changed first.
- **Received**: files people outside the company sent through your upload links, until you review them. The number next to it counts them.
- **Trash**: what you deleted, until it is deleted for good.
- **Document control** (administrators and document managers only): the rules for the whole company, in the Admin panel. See [the administrators' guide](admin#set-up-document-control).

**What CORE accepts.** CORE reads what a file really is from its content, never from its name, and keeps only the kinds the company accepts. Out of the box: PDF; pictures (JPEG, PNG, GIF, WebP, TIFF, BMP, HEIC); Word, Excel and PowerPoint, old and new; OpenDocument; RTF; text, CSV and data files; and e-mails (.eml, .msg). An administrator can also allow ZIP files, audio, video and CAD drawings. The largest file is 50 MB unless the company set another limit, and each person has room for 2,048 MB of documents (all versions counted; the bar under the folders shows how much you use).

**What is always refused**, whatever the settings, because it can run code on a computer or in a browser: programs and installers (.exe, .msi, .dmg…), scripts (.bat, .ps1, .js, .sh, .py…), shortcuts, web pages (.html) and SVG drawings, Office files with macros (.docm, .xlsm…), password-protected Office files, and ZIPs that contain any of these. A file whose name does not match its content (a PDF renamed *photo.jpg*, a program renamed *invoice.pdf*) is refused too: upload it with its real extension.

**How it is kept.** Every file is encrypted on the server with its own key, and its fingerprint (SHA-256) is checked every time someone downloads it. Each document gets a number (*DOC-2026-0012*), keeps its versions, and has an **Activity** list of who uploaded, viewed, downloaded, changed and shared it.

## Walkthrough

A first tour with the demo data (password `demo1234`). Sign in as `employee.demo` (Juan Dela Cruz).

1. Open the **CORE home** and click **Document Management**. **My files** opens: the folders on the left, a search box and filters, the drop zone, and your documents.
2. Drag a few files from your computer onto the page, or click **Upload** (or **choose files**). A window asks for the **Classification** (Internal unless you change it; see [Classification levels](#classification-levels)) and **Tags** (words to find them by, separated by commas); for one file, also its **Title**. Click **Upload**.
3. Each file goes up in pieces with a progress bar, then shows **Added as DOC-2026-0001**. A file CORE does not accept stays in the list with the reason, for example *Not accepted: The file is called .jpg but it is a PDF file*.

![My files, with three files added and one refused](documents.jpg)

4. Under **Company folders**, click **Contracts**: a folder an administrator shared with the Engineering department, where you can add files. The line under the title says who owns it and what you can do (*You: can edit*).

![A company folder](documents-folder.jpg)

5. Click a document to open it. At the top: **View** (PDFs and pictures open in a new tab), **Download**, **New version**, **Check out**, **Share** and **More**. Below: its **Details**, its **Versions** and its **Activity**.

![A document checked out by its editor](documents-document.jpg)

6. Click **Share** on a document of your own, then **Links outside the company** to see how a link is made. Click **Close** when you are done.

## How to…

### Upload files

1. Open the folder they go in (**My files**, or a folder you can edit).
2. Drop the files on the page, or click **Upload** and choose them. You can add several at once.
3. Choose the **Classification** and the **Tags** (for one file, check its **Title**), and click **Upload**.

Each file shows its result under **Uploads**. **Clear** empties that list when you are done. If the same content is already in the folder, CORE adds it anyway and says *The same content is already in this folder as DOC-…* (or refuses it, if the company chose so). A large file is sent in pieces: if your connection drops for a moment, the piece is sent again by itself.

### Make folders, rename, move or delete them

- **New folder** adds a folder inside the one you are in. It takes the access of the folder around it.
- In a folder you manage, **Folder** opens its menu: **Rename**, **Move** (into another folder you can edit), **Delete folder** (it goes to the trash with everything in it) and, for document managers, **Place legal hold**.
- Folders at the top level (**Company folders**) are added by document managers, with the **+** next to **Company folders** or **Company folder** in **Shared with me**.

### Find a document

Type in the search box and press Enter. CORE looks in titles, file names, tags, numbers (*DOC-2026-0012*), descriptions and the words inside PDFs, Word, Excel, PowerPoint and text files you can open. **Any classification** and **Any tag** narrow a list; on a phone they are under **Filters**. **Recent** lists what changed last.

### Change a document's details

On the document, under **Details**, change the **Title**, the **Status** (*Draft*, *Final* or *Obsolete*), the **Tags** or the **Description**, and click **Save**. The **Classification** is changed by the people who manage the document. Everything is recorded under **Activity**.

### Add a new version

1. Open the document and click **New version** (or drop the file on the page).
2. Choose the file. It must be the same kind of file as the document (a Word document takes a Word file). Say **What changed** if you like.
3. Click **Upload**. The new version becomes the current one; the earlier ones stay under **Versions**, each with who added it, when, and its fingerprint.

Under **Versions**, the eye opens a version in the browser (PDFs and pictures), the arrow downloads it, and **Restore** adds that version again as the newest one (nothing is lost). The company keeps 20 versions per document unless it set another number.

### Check a document out while you change it

1. Open the document and click **Check out**. A blue notice says **You have it checked out until…** (72 hours unless the company set another time).
2. Others can still open and download it, but nobody else can add a version or restore one; they see who has it and until when.
3. When you are done, upload your version and keep **Check it in after the upload** ticked, or click **Check in**.

A check-out ends by itself when its time is up. The people who manage the document can check it in for you.

### Share with people in the company

1. On a document or folder you manage, click **Share**. **People in the company** is open.
2. Under the list, choose **A person**, **An account type**, **A department** or **Everyone signed in**, then who, and the access: **Can view**, **Can edit** (add versions, check out, change the details) or **Can manage** (also share, move and delete). Click **Add**.
3. For each one, untick **Can download** to let them only view it in the browser, tick **Can re-share** to let them share it further, and set a date for the access to end if it should.
4. On a folder, **Inherit from parent** decides whether people with access to the folders above also have it here. Untick it to keep the folder to the people listed.
5. Click **Save access**.

![Sharing a document with a person and a department](documents-share.jpg)

You can never give more access than you have yourself. A folder's access goes to everything in it. Restricted documents are shared with named people only.

### Share a link with someone outside the company

1. On the document or folder, click **Share**, then **Links outside the company**. The box at the top says what the company allows before you start: how long a link can last, whether a password is needed, and why a link may not be possible (for example *Restricted documents are never shared by link*).
2. Choose what the link allows: **View only** (PDFs and pictures open in the browser; nothing is downloaded), **Download**, or, on a folder, **Upload** (see the next section).
3. Give it a **Password** (needed for confidential documents, and for every link if the company says so), the **Days it works**, the **Most downloads** if you want a limit, and a **Note for them**.
4. Click **Make link**. The link appears once, with **Copy**: *This link is shown only now*. CORE keeps only a fingerprint of it, so copy it before you close the window. Send the password another way (a call or a text message).

![A link just made, shown only once](documents-link.jpg)

The person who opens the link sees a page with your company's name, the note, the documents with **View** and **Download**, how many downloads are left and the last day it works. They need no account. If the link has a password, they type it first; after too many wrong tries they must wait.

![What the other person sees](documents-share-page.jpg)

Each link is listed under **Links** with what it allows, until when, whether it has a password, how often it was viewed and downloaded, and when it was last opened. **Turn off** stops it at once for everyone who has it. A link also stops by itself when it expires, reaches its download limit, when the document goes to the trash, when its maker can no longer share it, or when an administrator turns links off. You get a notification the first time a link is opened.

### Collect files from someone outside the company

1. Open a folder you can edit, click **Share**, **Links outside the company**, choose **Upload**, and click **Make link**.
2. Send the link. The other person sees a page to send files into that folder, with their name, e-mail and a message (all optional). They do not see what else is in the folder. Each file gets the same checks as your own uploads, and they see the result for each one.

![An upload link, as the other person sees it](documents-upload-link.jpg)

3. You get a notification for each file. It shows under **Received**, owned by you, marked **Received, not reviewed**, with the sender's name and message.
4. Open it, check it, and click **Mark reviewed**. Until then it stays under **Received**.

![A file received through an upload link](documents-received.jpg)

### Delete, restore and delete for good

- On a document you manage, **More → Move to trash**; on a folder, **Folder → Delete folder**. Links to it stop working.
- **Trash** lists what you deleted. **Restore** puts it back where it was (or in **My files** if that folder is gone). **Delete for good** removes a document and all its versions at once.
- What stays in the trash is deleted for good after 30 days, unless the company set another number.

### Legal hold

Document managers can place a **legal hold** on a document (**More → Place legal hold**) or a folder (**Folder → Place legal hold**), for example during an audit or a dispute. While it is on, nothing held can be moved to the trash or deleted, and old versions are kept. It shows as a red **Legal hold** badge.

### Classification levels

| Level | Who it is for | What CORE does |
|---|---|---|
| Public | Anyone | May be shared by link |
| Internal | People in the company (the default) | May be shared by link |
| Confidential | The people it is shared with | Links need a password |
| Restricted | Named people only | Never shared by link or with *Everyone signed in*; only the people who manage it download it |

The company can limit which levels may be shared by link (Document control).

## Screens at a glance

| Screen | What it is for |
|---|---|
| My files | Your own folder and the folders in it; upload, add folders |
| Shared with me | What others shared with you, your department or account type, and the company folders |
| Recent | The 50 documents you can open that changed last |
| Received | Files sent through your upload links, waiting for review |
| Trash | Deleted documents and folders: restore, or delete for good |
| A folder | Its documents and folders; **Share** and **Folder** (rename, move, legal hold, delete) for those who manage it |
| A document | View, download, new version, check out and in, share, move, legal hold, delete; details, versions and activity |
| Document control | For document managers, in the Admin panel: accepted file types, upload limits, sharing rules, retention and activity |

![The Contracts folder on a phone](documents-phone.jpg)

## Questions

**Why was my file refused?**
The message under **Uploads** says why. Most often: the kind of file is not accepted (ask an administrator), the name does not match the content (a renamed file: upload it with its real extension), it is a program, a script, a web page or an Office file with macros (never accepted), or it is larger than the limit.

**Can administrators see my files?**
Administrators and document managers can open every document, as they look after the company's records. Every view and download is in the document's **Activity** and in the audit log.

**I made a link but closed the window before copying it.**
CORE cannot show it again. Turn it off under **Links** and make a new one.

**Someone says my link does not work.**
It may have expired, reached its download limit, or been turned off; the document may be in the trash; or links may be turned off for the company. Open **Share → Links outside the company** to see its state, and make a new link if needed.

**Can someone with a link see my other documents?**
No. A document link opens that document; a folder link, the documents directly in that folder (never restricted ones); an upload link shows nothing at all.

**Is a checked-out document locked for reading?**
No. Others can still open and download it; only adding versions waits until it is checked in.

**Where are the files kept?**
On the company's CORE server, encrypted, in the `data/documents` folder. The backup download (Admin panel → Backup & restore) holds their details, not the files themselves: copy the whole `data` folder, with `data/secret.key` (which holds the key), to keep them.
