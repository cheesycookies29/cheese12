---
id: custom-app-events
title: Running an event in CUSTOM APP
summary: For event staff, the event's Super Administrator and administrators: find a guest, check them in, seat them at a table and chair, the tables, Event control (switches, exports, the printed plan, handing over the Super Administrator), Setup (the room, tables, staff, the guest list import and its check), and what to do on the night if something fails.
roles: eventstaff, admin
apps: customapp
order: 45
---

## Before you start

**CUSTOM APP** is CORE's module for apps made for a client. Its first app, **Events**, runs the registration desk of an event: the guest list, check-in, and seating by table and chair, within each table's limit of 10.

- **Event staff** sign in with a CORE account of the type *Event staff*. It opens CUSTOM APP and nothing else. Your administrator makes the account; the event's Super Administrator puts you on the event's staff and gives you your tables and guests.
- Each event has **exactly one Super Administrator**. They can do everything in that event: seat anyone anywhere, release reservations, set up the event and change its switches. Staff check in anyone, and seat only the guests and tables given to them.
- **Administrators** create events (CUSTOM APP → **Events** → **New event**) and can hand the Super Administrator over to someone else, with their password and a reason. That is their only power inside an event: being a CORE administrator does not let you seat guests.
- CUSTOM APP starts **off** for the company. An administrator turns it on under **Admin panel → Modules**.

The screens are made for a phone first: everything works at 390 pixels wide, buttons are large, and every count and badge says in words what its colour shows.

To try it with the demo data (**Admin panel → Demo data**), sign in as `eventlead.demo` (the Super Administrator of the demo event, *Demo Gala*) or `event.demo` (a staff member who owns tables 4 to 12), password `demo1234`.

## Walkthrough

1. Sign in as `eventlead.demo` and open **CUSTOM APP** from the CORE home. **Events** lists the events you are part of, with how many guests are invited, checked in and waiting, and how many seats are left. Click **Demo Gala**.

   ![Events, with the demo event](custom-app-events-events.jpg)

2. **Find guest** opens. Type part of a name, a company or a guest's ref (*DEMO-0054*), or tap **Waiting for a table** to see who has arrived and has no seat yet. Each guest shows their class (*Preferred*, *Regular*, *Employee*) and where they are: *Not arrived*, *Waiting for a table*, *Seated: T5 S3* or *Reserved: T2 S4*.

   ![Find guest on a phone, showing guests waiting for a table](custom-app-events-find.jpg)

3. Tap a guest. Their sheet shows who they are, **Arrival** and **Seat**. A guest who has not arrived has a **Check in** button. Once checked in, the tables they may sit at are listed with a meter of their chairs: a filled dot is a seated guest, a ring a reservation, and beside it the same in words (*6 seated · 2 reserved · 2 free*).
4. Tap a table. Its chairs appear with the **first free chair already chosen**; taken chairs are crossed out. Tap **Seat at Table 5, seat 3**. That is two taps from the list of tables to a seated guest.

   ![The guest sheet: a table chosen, its first free chair ready to confirm](custom-app-events-sheet.jpg)

5. Open **Tables** to see every table at once, its type, its owner and its meter. A full table says **Full**.

   ![Tables](custom-app-events-tables.jpg)

6. **Event control** has the counts (invited, checked in, not yet arrived, waiting for a table, seated and reserved, seats left), the switches, the exports and the printable seating plan.

   ![Event control](custom-app-events-control.jpg)

7. **Setup** is where the Super Administrator imports the guest list, clears the import check, and sets up the event, its room, tables, industries and staff.

   ![Setup: the guest list and the import check](custom-app-events-setup.jpg)

## How to…

### Seat a guest

1. In **Find guest**, find the guest and tap them.
2. If they show **Not arrived**, tap **Check in**. A preferred guest with a reserved chair is seated at once: their table and chair are retrieved, and the sheet shows *Table 2, seat 4: Seated*.
3. Otherwise, tap one of your tables (tables you do not own are under **Other tables (not yours)**, to see, not to use). The first free chair is chosen; tap another chair if the guest wants it.
4. Tap **Seat at Table N, seat M**. CORE checks the table, the chair and your authority at that moment, then saves it, and the sheet shows the seat.

To move a seated guest, open their sheet and tap **Move**, then choose the new table and chair: the old seat stays theirs until the new one is saved. **Send back to waiting** frees their chair. **Undo check-in** corrects a check-in made by mistake (their chair stays reserved for them).

### When a table fills up

Two people can choose the last chair of a table at the same moment. CORE saves one change at a time, so exactly one of them gets it. The other sees, on the same sheet with the guest still chosen, *Table 5 just filled. Updated options:* and the tables that still have room. Choose one of those.

If no table that the guest may sit at has a free chair, the sheet says so: **refer the guest to the Super Administrator**, who can open a table or change one. CORE never seats an eleventh guest at a table, and counts reservations of guests who have not arrived exactly like seated guests.

Other things the sheet may say, and what to do:

| It says | What happened | What to do |
|---|---|---|
| *That seat was just taken* | Someone took that chair first | Tap another chair |
| *This guest was seated or moved on another device* | Someone seated them meanwhile | Read where they are now; nothing to do |
| *This guest or table is not yours* | It belongs to another staff member | Ask its owner, or the Super Administrator |
| *This guest's reservation was released* | A preferred guest arrived after their reservation was released | Refer them to the Super Administrator |
| *The event is read only for now* | The Super Administrator turned on **Read only** | Wait, or work on paper |

### Find a guest at the desk

1. In **Find guest**, type part of the surname, the first name, the company or the ref. Surnames are found with or without spaces and accents (*delacruz* finds *Dela Cruz*).
2. For your own guests, the sheet shows their mobile and email masked (*•••• 4417*), enough to confirm who they are without reading the number out. For others' guests you see their name, company, industry and table.
3. Anyone on the staff can **Check in** any guest. Seating is for the guest's owner (or the Super Administrator).

If the guest is not on the list, do not add them yourself: walk-ins and substitutes go to the Super Administrator.

### Event control (Super Administrator)

**Switches** take effect on the next request, with no restart, and each change is in the audit log. Each asks you to confirm and says what it does:

- **Self check-in open**: lets guests check themselves in on the guest page (from 3 December) while the event's window is open. It cannot be opened while the import check has issues, unless you acknowledge them.
- **Email paused**: assignments are shown on screen and told by staff; messages wait.
- **Read only**: nobody can check in or seat anyone until it is turned off. Use it while you reconcile paper.
- **Refresh interval**: how often screens ask for changes (from 3 December).

**Exports**: **Event export (JSON)** is the event's recovery copy (the format *customapp.event/1*, with its change number and a fingerprint); **Guests (CSV)** and **Seating (CSV)** open in Excel; **Printable seating plan** opens a page that prints cleanly, with the room (tables where they stand, table 1 nearest the stage) and every table's chairs 1 to 10, stamped *As of* the time it was made. Every download is in the audit log. **Seating rules check** checks every rule at once (no table over its chairs, no chair or guest counted twice, exactly one Super Administrator).

**Hand over the Super Administrator** (administrators): choose the new Super Administrator, give the reason, enter your password. The current one loses every power at that moment; there is never more than one.

### Set up an event (Super Administrator)

1. **Room and tables**: the event's tables were made from its room when it was created (for example 5 rows × 5 columns of 10 chairs, stage on the right). Table 1 is nearest the stage, and tables run top to bottom, column by column, away from it; chair 1 faces the stage, and chairs run clockwise. **Edit** a table to set its type (*Preferred*, *Regular*, *Employee*, *Mixed*), chairs (1 to 10) and owner. A table with guests cannot be made smaller than them or taken out of use until they are moved. **Lay out the room again** works only while nobody has a seat.
2. **Staff**: tick the accounts on the event's staff and **Save staff**.
3. **Industries**: one per line, related ones after a colon (*Banking: Insurance, Real estate*); a relation is kept both ways.
4. **Event**: name, date, venue, the self check-in window (in Manila time), status, and **Chair numbers** (every guest, preferred guests only, or tables only). **Mixed tables in use** lets anyone sit at tables marked *Mixed*. **Owners may release reservations** lets a table's owner release a reservation at their table; otherwise only you can.

### Import the guest list (Super Administrator)

1. In **Setup → Guest list**, click **Choose a file…** and pick the list, as CSV or Excel (.xlsx), up to 2,000 rows and 2 MB. The first row names the columns: *Ref*, *First name*, *Surname* (or *Name*), *Designation*, *Company*, *Industry*, *Email*, *Mobile*, *Classification* (preferred, regular, employee), *RSVP*, *Personnel* (the staff member's username), *Table* and *Seat* (a preferred guest's reserved chair).
2. Nothing is added yet. CORE shows what it read: new guests, guests to update, and anything to fix in the file first (an unknown classification, a table that does not exist, two guests for one chair, a table with more guests than chairs, more guests than the room seats). Fix those in the file and choose it again.
3. Click **Add N guests**. The whole list goes in at once.

Importing the list again updates guests by their *Ref*. Once the event is live, an import never changes anyone's check-in, seat or owner.

### Clear the import check (Super Administrator)

**Setup → Import check** lists guests self check-in could not tell apart or verify: two guests with the same surname and the same last 4 digits of their mobile, guests with no mobile and no email, possible duplicates, and industries not in the event's list. For each guest: **Add email**, **Add mobile**, or **Desk only** (they are checked in at the desk). **Acknowledge** accepts the rest. Self check-in stays closed until the list is clear or acknowledged.

### If the system is down

Keep calm: the paper plan and the export are the fallback, and nothing is lost by stopping.

1. If CORE restarts, everyone is signed out: sign in again and you are back on your page.
2. If it stays down, work from the **printed seating plan** and the guest list on paper: each staff member seats only at their own tables, and writes down each check-in and seat with the time.
3. When CORE is back, the Super Administrator turns on **Read only**, enters the paper sheets, then turns it off again.

On the day (for the Super Administrator and the on-call developer):

- **Three hours before:** the deploy freeze is on; a fresh off-server backup is confirmed in the Security monitor; the standby is topped up; a test guest is checked in, seated and checked out again; the newest event export is under 5 minutes old and on the laptop; the seating plan is printed (*As of* stamped); staff devices are signed in, on the 4G hotspot, charged.
- **Doors:** turn on **Self check-in open** (from 3 December).
- **Act on any of these:** errors on event pages above 1% for 2 minutes; 2 failed uptime checks in a row; saving slower than 250 ms; a guest waiting for a table more than 3 minutes; more than 5 failed emails; the seating rules check not clean; under 1 GB of free disk.
- **Step down, one step at a time** (each can be undone, none needs a deploy): a slower refresh interval; **Email paused**; self check-in closed (the desk checks everyone in); paper by table owner with **Read only** on; the standby, then the paper and the newest export entered as commands.
- **Never run RESTORE.md §1 while an event is `live`.** CORE's own **Restore a backup** screen keeps a live event's data as it is, but copying an older data file over the server would roll back every check-in.
- **Close:** turn self check-in off, download the final JSON and CSV exports, run an off-server backup, set the date the guest data is to be deleted.
- **The next morning:** lift the freeze, archive the export, hand it to the client, start the clock for deleting the guest data.

## Screens at a glance

| Screen | What it is for |
|---|---|
| **Events** | The events you are part of, with their counts; **New event** for administrators |
| **Find guest** | Search by name, company or ref, filter by who is waiting, not arrived, seated or reserved; tap a guest to check them in and seat them |
| **Tables** | Every table with its type, owner and meter of chairs; tap one for its chairs and who sits on them |
| **Event control** | The counts, the switches, the exports and the printable seating plan, the seating rules check, handing over the Super Administrator |
| **Setup** | The guest list import and the import check, the event's details and window, the room and tables, industries and staff (the Super Administrator's) |

## Questions

**Why can't I seat a guest who is on my screen?**
Seating is for the guest's owner and the table's owner. You can check anyone in; their owner or the Super Administrator seats them. This is the client's rule: every guest and table has at most one owner, and only the Super Administrator acts everywhere.

**Does a reservation run out if the guest is late?**
No. A preferred guest's reserved chair stays theirs until they arrive or the Super Administrator releases it, with a reason. Nothing is released by time.

**Two of us pressed Seat at the same time. Who got the chair?**
Whoever's request reached CORE first; the other saw the updated options. CORE checks the table, the chair and your authority immediately before it saves, one change at a time, so a table can never go over 10.

**I am a CORE administrator. Why can't I change seats?**
An event's authority belongs to its Super Administrator, so that there is exactly one. You can hand the role over (to yourself too) under **Event control**; that is recorded in the audit log.

**What happens to the event if someone restores a backup?**
Nothing: while the server holds an event, **Admin panel → Backup & restore** keeps the event's guests, check-ins and seats as they are, and the full backup download leaves a live event's guest list out unless you tick to include it. Each event's own export is its recovery copy.
