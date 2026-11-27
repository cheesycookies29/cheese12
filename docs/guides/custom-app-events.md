---
id: custom-app-events
title: Running an event in CUSTOM APP
summary: For event staff, the event's Super Administrator and administrators: My queue, the guest page guests check in on, the room plan, finding and checking in a guest (also by the code the guest page gives), seating at a table and chair with recommended tables, Event control (switches, health, moving a staffer's guests, the reception QR, exports, the printed plan, handing over the Super Administrator), Setup (the room, tables, staff, the guest list import and its check), and what to do on the night if something fails.
roles: eventstaff, admin
apps: customapp
order: 45
---

## Before you start

**CUSTOM APP** is CORE's module for apps made for a client. Its first app, **Events**, runs the registration desk of an event: the guest list, check-in, and seating by table and chair, within each table's limit of 10.

- **Event staff** sign in with a CORE account of the type *Event staff*. It opens CUSTOM APP and nothing else, on **My queue**. Your administrator makes the account; the event's Super Administrator puts you on the event's staff and gives you your tables and guests.
- **Guests** check themselves in on their phone: they scan the reception QR code, which opens the event's **guest page** (*/event/…*), type their surname and the last 4 digits of their mobile (or their full email), and see their table as soon as it is chosen. Nobody needs an account for it.
- Each event has **exactly one Super Administrator**. They can do everything in that event: seat anyone anywhere, release reservations, set up the event and change its switches. Staff check in anyone, and seat only the guests and tables given to them.
- **Administrators** create events (CUSTOM APP → **Events** → **New event**) and can hand the Super Administrator over to someone else, with their password and a reason. That is their only power inside an event: being a CORE administrator does not let you seat guests.
- CUSTOM APP starts **off** for the company. An administrator turns it on under **Admin panel → Modules**.

The screens are made for a phone first: everything works at 390 pixels wide, buttons are large, and every count and badge says in words what its colour shows.

To try it with the demo data (**Admin panel → Demo data**), sign in as `eventlead.demo` (the Super Administrator of the demo event, *Demo Gala*) or `event.demo` (a staff member who owns tables 4 to 12), password `demo1234`.

## Walkthrough

1. Sign in as `event.demo` on a phone. CUSTOM APP opens on **My queue**: the bar at the top names the event and you and says how old the screen is (*Last updated 2 s ago*). Below it, **Waiting for table** lists the guests given to you who have checked in and have no seat yet, oldest first, each with their company, industry, class and how long they have waited (amber after 4 minutes, red after 8). Then **Checked in and seated**, and **Find guest**. The screen updates by itself every few seconds.

   ![My queue on a phone](custom-app-events-queue.jpg)

   Sign in as `eventlead.demo` and open **Events** in the side menu: the events you are part of, with how many guests are invited, checked in and waiting, and how many seats are left. Click **Demo Gala**.

   ![Events, with the demo event](custom-app-events-events.jpg)

2. **Find guest** opens. Type part of a name, a company or a guest's ref (*DEMO-0054*), or tap **Waiting for a table** to see who has arrived and has no seat yet. Each guest shows their class (*Preferred*, *Regular*, *Employee*) and where they are: *Not arrived*, *Waiting for a table*, *Seated: T5 S3* or *Reserved: T2 S4*.

   ![Find guest on a phone, showing guests waiting for a table](custom-app-events-find.jpg)

3. Tap a guest. Their sheet shows who they are, **Arrival** and **Seat**. A guest who has not arrived has a **Check in** button. Once checked in, the tables they may sit at are listed with a meter of their chairs: a filled dot is a seated guest, a ring a reservation, and beside it the same in words (*6 seated · 2 reserved · 2 free*).
4. Tap a table. Its chairs appear with the **first free chair already chosen**; taken chairs are crossed out. Tap **Seat at Table 5, seat 3**. That is two taps from the list of tables to a seated guest.

   ![The guest sheet: a table chosen, its first free chair ready to confirm](custom-app-events-sheet.jpg)

5. Open **Room plan** to see the room as it stands: the tech booth on one side, the stage on the other, every round table numbered from the stage, and every chair. An open chair is a hollow ring, a chair reserved for a guest who has not arrived is hatched, a seated guest is a solid chair with their initials, and the chair you choose gets a thick ring; the legend above the plan says so. Preferred tables are tinted gold, employee tables have a dashed edge, a full table says **FULL**, and tables that are not yours are faded and say **NOT YOURS**. Choose a guest under **Waiting for a seat**: their three best tables get a gold ring and a number (1 to 3), and tables they cannot sit at fade.

   ![The room plan with a guest chosen: three tables ranked](custom-app-events-room.jpg)

6. Choose a table (on the plan, or one of the recommendations beside it). Its ten chairs appear around it as large buttons, each saying who sits there (*Chair 4: Maria Santos, Northbay Bank*). Choose an open chair, then **Seat here**.

   ![A table's chairs on a phone, ready to seat a guest](custom-app-events-room-table.jpg)

7. Open **Tables** to see every table as a list, its type, its owner and its meter. A full table says **Full**.

   ![Tables](custom-app-events-tables.jpg)

8. **Event control** has the counts (invited, checked in, not yet arrived, waiting for a table, seated and reserved, seats left), the health of the event, the room plan, who has how many guests waiting, the switches, the reception QR sheet, the exports and the printable seating plan.

   ![Event control](custom-app-events-control.jpg)

9. The guest's side: the **guest page** on their phone. After they check in it says *You're checked in. We're choosing your table*, and as soon as staff seat them it shows their table in large type, and their seat.

   ![The guest page on a phone, with the table](custom-app-events-guest.jpg)

10. **Setup** is where the Super Administrator imports the guest list, clears the import check, and sets up the event, its room, tables, industries and staff.

   ![Setup: the guest list and the import check](custom-app-events-setup.jpg)

## How to…

### Seat a guest

1. In **My queue**, tap the guest under **Waiting for table** (or find them in **Find guest**).
2. If they show **Not arrived**, tap **Check in**. A preferred guest with a reserved chair is seated at once: their table and chair are retrieved, and the sheet shows *Table 2, seat 4: Seated*.
3. Otherwise, the sheet shows up to three **Recommended** tables of yours, best first, each with why: *Same industry: Banking, 3 of 6 seated*, *Related: Insurance*, *4 seats left*. Guests meet people from their own or a related industry, and gaps are filled before new tables are started. **Other eligible tables** (folded) are your other tables the guest may sit at; **Not yours** lists other people's tables, to see, not to use.
4. Tap a table. The first free chair is chosen; tap another chair if the guest wants it.
5. Tap **Seat at Table N, seat M**. CORE checks the table, the chair and your authority at that moment, then saves it, and the sheet shows the seat. The recommendation is advice: any eligible table of yours is accepted.

### Use the room plan

**Room plan** (and the plan on **Event control**) shows the same seats as the lists, drawn as the room, and seats guests the same way.

- **Choose a guest** under **Waiting for a seat**: the plan rings and numbers their three best tables, and fades the tables they cannot sit at. The panel lists the same recommendations, with why.
- **Choose a table**, then a chair (on the plan, or among the ten chair buttons beside it), then **Seat here**.
- **Choose a taken chair** to see who sits there. For a chair reserved for a guest who has not arrived: **Arrived: seat now** (checks them in on that chair) and, for the Super Administrator, **Release reservation**. For a seated guest: **Move** (then choose the new chair, and **Move here**) or **Back to waiting**.
- **Zoom and move around**: **+** and **−** zoom, **Fit** shows the whole room; drag or scroll to move around once zoomed in, and Ctrl+scroll zooms. With the keyboard: click the plan, then the arrow keys move from table to table in the same row or column, **Enter** opens a table, **+** and **−** zoom and **1** fits the room.
- The plan updates by itself: a chair taken on another device shows within a few seconds. If someone took your chair meanwhile, the plan redraws and says so (*Chair 3 at table 5 was just taken on another device*): choose another.

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
| *…is no longer yours: the Super Administrator gave it to someone else* | The guest was moved to another staffer's queue while you had them open | Nothing to do; they are in the other person's queue |
| *This guest's reservation was released* | A preferred guest arrived after their reservation was released | Refer them to the Super Administrator |
| *The event is read only for now* | The Super Administrator turned on **Read only** | Wait, or work on paper |

### Work from My queue

**My queue** is where you start. It updates by itself; the bar at the top says *Last updated 2 s ago*, and if the connection drops for 15 seconds it turns amber and says *Reconnecting…* (it carries on by itself when the connection is back).

- **Waiting for table**: your guests who have arrived, oldest first. Tap one to seat them.
- If the Super Administrator gives one of your guests to someone else, the card greys out with *Moved to Maria's queue by the Super Administrator, 6:52 PM* for a few seconds before it leaves your list.
- When nobody is waiting, it says so, with your tables and their free seats: *No one is waiting for you. Your tables: 5, 6, 7 (14 seats left).*
- The Super Administrator's queue holds every guest who has no owner, preferred guests whose reservation was released and who have now arrived, and under **Needs a look** guests who verified again from another phone.

### Help a guest who shows a code

When the guest page cannot check someone in (a typing mistake, two guests it cannot tell apart, too many tries), it shows *Please see the registration desk and show this code: R-4821*. It never says why, so nobody can learn the guest list from it.

1. Type the code in **Find guest** (on My queue or the Find guest page).
2. CORE shows what the guest typed (the surname, and the last 2 of the digits), the real reason, and the guests on the list with that surname.
3. Tap **Check in**. If the reason is the cap (more than 8 different wrong numbers for one surname in 15 minutes), the button is **Clear cap and check in**: one tap does both.

Codes are kept for 3 hours, and until CORE restarts; without the code, search by name.

### Find a guest at the desk

1. In **Find guest**, type part of the surname, the first name, the company or the ref (or a guest page code). Surnames are found with or without spaces and accents (*delacruz* finds *Dela Cruz*).
2. For your own guests, the sheet shows their mobile and email masked (*•••• 4417*), enough to confirm who they are without reading the number out. For others' guests you see their name, company, industry and table.
3. Anyone on the staff can **Check in** any guest. Seating is for the guest's owner (or the Super Administrator).

If the guest is not on the list, do not add them yourself: walk-ins and substitutes go to the Super Administrator.

### The guest page

Each event has its own guest page, */event/* and the event's code (shown on **Event control**). It answers only while the event is *live*.

- Before the window opens it says *Registration opens at 6:00 PM.* and takes nothing.
- Once it is open, the guest types their **surname** and the **last 4 digits of their mobile** (or taps **Use email instead** and types their full email). Spaces, hyphens, accents and *Jr.* do not matter; the surname must be the one on the list.
- A match checks them in at once: *You're checked in. We're choosing your table.* The page then updates by itself, and shows **Table N** in large type and the seat as soon as staff seat them. After 4 minutes of waiting it adds *A staff member can help at the desk*. It keeps showing the table after a reload, and the last status while the phone is offline.
- Anything else gives the desk code (see **Help a guest who shows a code**).
- Checking in again from another phone shows the same status, never a second check-in; the guest's sheet then says *Verified again from another device* (the Super Administrator taps **Seen**). **End it on every device** on the sheet (the guest's owner) stops the page on a lost phone.
- After the doors, with **Self check-in open** turned off, the page sends everyone to the desk.

### Event control (Super Administrator)

**Health** shows the change number, the age of the newest **5-minute copy** of the event (written on the server every 5 minutes while the event is live, the last 24 kept) and the **seating rules** check (run every minute while live; a problem shows in red here and in the Security monitor). A banner appears when the guest page has had more than 30 failed checks in 5 minutes: nobody is locked out, but guests with a code will come to the desk.

**Staff and their queues** shows each staff member's waiting guests and longest wait. **Move to…** gives all of one person's guests and tables to someone else at once (for example someone who is absent): their seats and check-ins stay as they are, and from that moment only the new owner (and you) can seat them. To move one guest, open their sheet and change **Owner**; to move one table, use **Setup → Room and tables → Edit**.

**Switches** take effect on the next request, with no restart, and each change is in the audit log. Each asks you to confirm and says what it does:

- **Self check-in open**: lets guests check themselves in on the guest page while the event's window is open. It cannot be opened while the import check has issues, unless you acknowledge them.
- **Email paused**: assignments are shown on screen and told by staff; messages wait.
- **Read only**: nobody can check in or seat anyone until it is turned off. Use it while you reconcile paper.
- **Refresh interval**: how often staff screens ask for changes (2,000 ms is 2 seconds); a guest's page waiting for a table asks half as often, and once seated a fifth as often. Raise it (for example to 4,000) if the server is slow: it applies on every screen's next request.
- **Presence key on the reception QR**: off unless decided after the load test. When on, only a phone that scanned the reception QR printed with the key can check in; the key is shown once, so print **Reception QR sheet** when you turn it on.

**Reception QR sheet** prints the QR code of the guest page for the easel at reception, with *If this page doesn't open, please go to the registration desk.*

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
- **Doors:** turn on **Self check-in open**.
- **Act on any of these:** errors on event pages above 1% for 2 minutes; 2 failed uptime checks in a row; saving slower than 250 ms; a guest waiting for a table more than 3 minutes; more than 5 failed emails; the seating rules check not clean; under 1 GB of free disk.
- **Step down, one step at a time** (each can be undone, none needs a deploy): a slower refresh interval; **Email paused**; self check-in closed (the desk checks everyone in); paper by table owner with **Read only** on; the standby, then the paper and the newest export entered as commands.
- **Never run RESTORE.md §1 while an event is `live`.** CORE's own **Restore a backup** screen keeps a live event's data as it is, but copying an older data file over the server would roll back every check-in.
- **Close:** turn self check-in off, download the final JSON and CSV exports, run an off-server backup, set the date the guest data is to be deleted.
- **The next morning:** lift the freeze, archive the export, hand it to the client, start the clock for deleting the guest data.

## Screens at a glance

| Screen | What it is for |
|---|---|
| **Events** | The events you are part of, with their counts; **New event** for administrators |
| **My queue** | Where Event staff start: your guests waiting for a table (oldest first, with how long), those seated, and Find guest; it updates by itself |
| **Room plan** | The room with every table and chair; choose a waiting guest to see their best tables, then a chair, then **Seat here** |
| **Find guest** | Search by name, company or ref, filter by who is waiting, not arrived, seated or reserved; tap a guest to check them in and seat them |
| **Tables** | Every table with its type, owner and meter of chairs; tap one for its chairs and who sits on them |
| **Event control** | The counts, health, the room plan, staff and their queues (**Move to…**), the switches and the reception QR, the exports and the printable seating plan, the seating rules check, handing over the Super Administrator |
| **Guest page** (*/event/…*) | Guests check themselves in on their phone and see their table; no account |
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

**A guest says the page will not take their number. What do I do?**
Ask for the code on their screen and type it in **Find guest**: you see what they typed and why it did not match (a different mobile on the list, a colleague with the same surname and digits, or too many tries). Check them in from there. The page never tells the guest the reason, on purpose.

**Can someone check a colleague in from home?**
Only while the window is open, and only with the colleague's surname and mobile digits; staff see *Verified again from another device* if the real guest then checks in too. With the presence key on, only a phone that scanned the QR at reception can check in.

**Why is a table ringed with a number on the plan?**
It is one of the three best tables for the guest you chose: same industry first, then a related industry, then any table with room, filling gaps before starting empty tables. You may choose any other eligible table.
