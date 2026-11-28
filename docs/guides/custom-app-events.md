---
id: custom-app-events
title: Running an event in CUSTOM APP
summary: For event staff, the event's Super Administrator and administrators: personal invitations by email with a QR code, the guest's Yes or No with the seat reserved at once on Yes, check-in at the door by the same link, My queue, the guest page guests check in on, the room plan, finding and checking in a guest (also by the code the guest page gives), seating at a table and chair with recommended tables, seating a group together, walk-ins and substitutes, seat emails, Event control (the exceptions inbox, health, staff and their queues, switches, the reception QR, exports, the printed plan and the offline pack, reconciling paper seating, handing over the Super Administrator), Setup (the room, tables, staff, the guest list import and its check), and what to do on the night if something fails.
roles: eventstaff, admin
apps: customapp
order: 45
---

## Before you start

**CUSTOM APP** is CORE's module for apps made for a client. Its first app, **Events**, runs the registration desk of an event: the guest list, check-in, and seating by table and chair, within each table's limit of 10.

- **Event staff** sign in with a CORE account of the type *Event staff*. It opens CUSTOM APP and nothing else, on **My queue**. Your administrator makes the account; the event's Super Administrator puts you on the event's staff and gives you your tables and guests.
- **Guests** get a personal **invitation** by email, with their own link and QR code. They answer **Yes** or **No** on it; on Yes their seat is reserved at once and emailed to them. On the night the same link (or its QR code) checks them in at the door. Guests can also check themselves in on their phone: they scan the reception QR code, which opens the event's **guest page** (*/event/…*), type their surname and the last 4 digits of their mobile (or their full email), and see their table as soon as it is chosen. Nobody needs an account for any of it.
- Each event has **exactly one Super Administrator**. They can do everything in that event: seat anyone anywhere, release reservations, set up the event and change its switches. Staff check in anyone, and seat only the guests and tables given to them.
- **Administrators** create events (CUSTOM APP → **Events** → **New event**) and can hand the Super Administrator over to someone else, with their password and a reason. That is their only power inside an event: being a CORE administrator does not let you seat guests.
- CUSTOM APP starts **off** for the company. An administrator turns it on under **Admin panel → Modules**.

The screens are made for a phone first: everything works at 390 pixels wide, buttons are large, and every count and badge says in words what its colour shows.

To try it with the demo data (**Admin panel → Demo data**), sign in as `eventlead.demo` (the Super Administrator of the demo event, *Demo Gala*) or `event.demo` (a staff member who owns tables 4 to 12), password `demo1234`. The demo has a walk-in and a substitute waiting for the Super Administrator, and its email is paused.

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

8. A group arriving together: in **My queue** (or **Find guest**), tick the guests, then tap **Seat together (3)**. Only tables with room for all of them are offered, best first; tap one, then **Seat together at Table 5**.

   ![Three guests ticked in My queue, with the tables that fit them together](custom-app-events-group.jpg)

9. **Event control** (`eventlead.demo`) has the counts (*Invited · Checked in · Not yet arrived · Waiting for table · Needs approval · RSVP · Seats left*), the health of the event, the **Exceptions** inbox, the room plan, who has how many guests waiting, the switches, the reception QR sheet, the exports, the printable seating plan, the offline pack and **Reconcile paper seating**. It updates by itself, like My queue.

   ![Event control](custom-app-events-control.jpg)

   **Exceptions** lists everything that needs the Super Administrator: here the demo's walk-in and a substitute, shown as one seat changing hands (*Seat 3-5: Rafael Garcia replaces Maria Garcia*), each with **Approve…** and **Do not admit…**. Approving the substitute gives them the invitee's seat, or releases it.

   ![Approving a substitute from the exceptions inbox](custom-app-events-inbox.jpg)

10. The guest's side: the **guest page** on their phone. After they check in it says *You're checked in. We're choosing your table*, and as soon as staff seat them it shows their table in large type, and their seat.

   ![The guest page on a phone, with the table](custom-app-events-guest.jpg)

11. **Invitations**, on Event control (`eventlead.demo`): how many invitations wait, went or failed, how many were opened, and the answers (*Yes*, *No*, *No reply*). Above the buttons, anything that would stop or spoil the invitations is said in words (here: the demo has no outgoing email, and its links would point to the demo computer). **Preview** shows the email as a guest gets it, with the QR code; **Send invitations** sends one to every guest with an email address who has none yet.

   ![Invitations on Event control](custom-app-events-invitations.jpg)

   ![The invitation, previewed](custom-app-events-invite-preview.jpg)

   The guest opens their link: their name, the event, and **Yes, I will attend** or **No, I can't attend**. To try it, make the demo event *Live* (**Setup → Event → Status**) and open */event/* and the demo event's code followed by *#i=demo-invitation-link-for-the-guides-0000001* (the one demo guest whose link is known).

   ![A guest's invitation on their phone](custom-app-events-invite.jpg)

   On **Yes** their seat is reserved at once, and the page (and an email) gives the table and seat. Until replies close they can change their answer.

   ![After Yes: the seat reserved](custom-app-events-invite-yes.jpg)

12. **Setup** is where the Super Administrator imports the guest list, clears the import check, and sets up the event, its room, tables, industries and staff.

   ![Setup: the guest list and the import check](custom-app-events-setup.jpg)

## How to…

### Seat a guest

1. In **My queue**, tap the guest under **Waiting for table** (or find them in **Find guest**).
2. If they show **Not arrived**, tap **Check in**. A preferred guest with a reserved chair is seated at once: their table and chair are retrieved, and the sheet shows *Table 2, seat 4: Seated*.
3. Otherwise, the sheet shows up to three **Recommended** tables of yours, best first, each with why: *Same industry: Banking, 3 of 6 seated*, *Related: Insurance*, *4 seats left*. Guests meet people from their own or a related industry, and gaps are filled before new tables are started. **Other eligible tables** (folded) are your other tables the guest may sit at; **Not yours** lists other people's tables, to see, not to use.
4. Tap a table. The first free chair is chosen; tap another chair if the guest wants it.
5. Tap **Seat at Table N, seat M**. CORE checks the table, the chair and your authority at that moment, then saves it, and the sheet shows the seat. The recommendation is advice: any eligible table of yours is accepted.

### Seat a group together

When guests arrive together (colleagues from one company, a family), seat them at one table:

1. In **My queue**, tick each of them under **Waiting for table** (or, in **Find guest**, tick the guests who are waiting for a table). A bar appears: *3 guests selected*.
2. Tap **Seat together (3)**. CORE offers only tables with 3 free chairs or more, best first, with why (*Same industry: Banking*, *4 seats left*).
3. Tap a table, then **Seat together at Table 5**. All of them are seated in one change, each at the next free chair, or none of them is: if the table filled up meanwhile, the sheet says so and shows the tables that still fit.

If no table has room for all of them, the sheet says *No table has 3 free chairs together* and shows a split instead, the largest parts first (*Table 5: 2 guests · Table 6: 1 guest*). **Split group…** asks you to confirm, because they will not all sit together; nothing is split without it.

Guests of different staff members cannot be seated together by one of them: the sheet shows **Send group to Super Administrator**. The group then appears in the Super Administrator's **Exceptions** as *Seat together (3)*, and they seat it. Each guest keeps their own check-in and seat: moving one later moves only that guest.

### Add a walk-in or record a substitute

Nobody is admitted who is not on the list until the Super Administrator says so.

- **Add walk-in** (under **Find guest**, and on **My queue**): someone who is not on the list. Type their name, company and, if they have one, their email; add a note (*Says she is with Northbay Bank*). Tap **Send for approval**. They are not checked in yet, and cannot be seated.
- **Record substitute** (on the guest's sheet, for a guest who has not arrived): someone here instead of the invitee. Type the substitute's name and a note (*Pedro is unwell; his son Juan comes instead*), then **Send for approval**. Until it is approved, nothing changes: the invitee keeps their seat.

The Super Administrator sees both in **Event control → Exceptions** (a substitute as one seat changing hands: *Seat 3-4: Juan Reyes replaces Pedro Reyes*) and decides:

- **Approve…** a walk-in: choose the class they sit as (*Regular*, *Preferred* or *Employee*), their industry and an owner. They are checked in at once and wait for a table like anyone else.
- **Approve…** a substitute: the invitee's seat is given to the substitute in the same change (or **released**, if you choose so, and the substitute waits for a table). The invitee and the substitute never both hold a seat, and the invitee cannot check in afterwards.
- **Do not admit…**: with a reason.

Every step is in the guest's **History** with who did it and when, and in the audit log. As the Super Administrator, **Record substitute** approves it at once.

### Send the invitations (Super Administrator)

Each guest gets their own invitation by email: a button and the address of their personal link, and the same link as a QR code. The link is */event/* and the event's code, then *#i=* and a long code that is theirs alone. CORE keeps only a fingerprint of it, so nobody (staff included) can read a guest's link back.

Before the first invitation:

1. Outgoing email is set up for CORE under **IT Service Desk → Settings → Sending email**, with **Use for CUSTOM APP event emails** ticked (with Amazon SES: see [Set up email with Amazon SES](admin#set-up-email-with-amazon-ses)). It is separate from the helpdesk's **Send replies by email**.
2. **Setup → Event**: **Email from** is the event's own address on the domain set up for email (for example *events@ltdc-core.com*), never the IT Service Desk's mailbox, and **Status** is *Live* (the links answer only while the event is live).
3. **Event control → Invitations → Invitation settings…**: the **Subject**, the **Opening text**, the **Time**, **Venue** and **Dress code** shown with the date, **Reply by** (Manila time, before the event), the **Closing note** (optional), and **Seat on Yes** (on unless you turn it off). Leave **Public address for the links** empty to use the address you are using CORE on (*https://ltdc-core.com*); the links then point there.

   The **Opening text** and the **Closing note** are written in the same editor as task descriptions: **bold**, *italics*, links, bulleted and numbered lists, headings, quotes and tables (type `/`, or use the toolbar). The email shows them formatted, its plain-text part (for email programs that show no formatting) as plain text, and the guest's page shows the opening text formatted too. The closing note ends both the invitation and the seat email, before the event's name: a good place for *This email is sent automatically. Please do not reply to it.* Pictures cannot be added.

   ![Invitation settings, with the opening text in the editor](custom-app-events-invite-settings.jpg)
4. **Preview** shows the email as a guest gets it, formatted as an email program shows it, with the plain-text version under it. **Send a test…** sends one now, from the event's address, to any address you type: try a Gmail, an Outlook and a Yahoo address, and check it arrives in the inbox with the QR code showing. The test's link does not work.
5. Turn email on: **Event control → Switches → Email paused: Off**.

Then **Send invitations (N)**: one invitation for every guest with an email address who has none yet. They go one at a time through the outbox; the counts move from *Waiting to go* to *Sent* (or *Failed*). While email is paused they wait.

- The box above the buttons says what would stop or spoil the invitations: no From address, the helpdesk mailbox as From, or an event not *Live* stop **Send invitations**; a From address on another domain than the site, or links that would point to an address guests cannot open (*http://localhost…*), are warnings.
- Guests with **no email address** are listed under the buttons. **Add email**, then send theirs; or tell them by phone.
- **Every guest's RSVP** lists each guest with their answer, their invitation and their seat. **Send again** (or **Send invitation again (new link)** on the guest's sheet) sends a new invitation with a **new link**: the link in the earlier email stops working, and their answer and seat stay as they are. **Revoke link** on the sheet stops a link at once (sent to a wrong address, forwarded).
- A failed invitation shows in **Exceptions** (*Invitation to … failed*): check the address, then send it again.

### The guest's answer, and seat on Yes

On their link the guest sees their name, the event (date and time, venue, dress code), the opening text and two buttons: **Yes, I will attend** and **No, I can't attend**. Until replies close (at **Reply by**, or when self check-in opens if that is earlier) they can **Change my answer** as often as they like.

- **Yes**, with **Seat on Yes** on: CORE gives them a seat at once, by the same rules as the recommendations (their industry first), at the best table for them and its lowest open chair. It is a **reservation**: it holds the chair until the night, counts toward the table's 10, and shows as *Reserved* (*Reserved: said Yes* on the room plan). The page says *Your seat is reserved: Table 12, seat 4*, and an email gives the table, the seat and the QR code again.
- A **preferred guest** keeps the seat reserved for them; Yes only records that they are coming. A preferred guest without a reservation is not placed by CORE: they are in **Exceptions** for you.
- **No eligible seat left** (or **Seat on Yes** off): the page says *We will email your table*, and the guest is in **Exceptions** (*… said Yes and has no seat yet*). Open them and **Reserve a seat…**: CORE emails them the table.
- **No**: a seat their own Yes reserved is released at once. Any other reservation (a preferred guest's, or one you made) is **never released by CORE**: the guest is in **Exceptions** (*… said No and still holds …*) for you to release by hand if they are really not coming.
- Yes, then No, then Yes again never holds two chairs, and two guests saying Yes to the last chair at the same moment never both get it: one has it, the other is told the table follows.
- A guest who answered by phone: open them and **Record Yes** or **Record No** (the same rules).
- A guest's owner stays as it is; the seat is CORE's, recorded in their **History** as *Answered the invitation, by The guest's invitation link*.

**Find guest** filters by the answer: **Said Yes**, **Said No**, **No reply**, **Not invited**. The counts on Event control add *RSVP: N yes* once invitations have gone.

### Check in at the door with the invitation

On the night, while **Self check-in open** is on and the window is open, the guest's link offers **Check in**, with no surname to type: the link proves who they are. Then it shows their table in large type, and their seat, as the guest page does. The usher can also scan the QR code in the guest's email with any phone: the same page opens, with **Check in**.

- A reserved seat becomes *Seated* at check-in. A guest with no seat yet waits for a table as usual.
- Checking in twice changes nothing. Before the doors open the link says check-in opens on the night.
- Everyone else uses the reception QR and their surname as before; a guest does not need to have answered to be checked in.
- A link that is revoked, replaced or mistyped gives the same desk code as the guest page (*Please contact the organisers and quote this code: R-1234*); type it in **Find guest** to see why.

### Seat emails

When a guest with an email address is seated, CORE emails them their table and chair, and emails them again if it changes. The email goes from the event's own address (**Setup → Event → Email from**), never from the IT Service Desk's mailbox, through CORE's outgoing email (set up under **IT Service Desk → Settings → Sending email**).

- Email is **paused** for a new event. The Super Administrator turns it on under **Event control → Switches** (*Email paused: Off*), once the From address is set.
- The email is sent after the seat is saved, one at a time. A failed email never changes the seat or the check-in: the guest's sheet says *Seat email failed* and the seat is safe. **Resend** on the sheet (the guest's owner or the Super Administrator) sends it again; a failure also shows in **Exceptions** with **Resend**.
- A guest without an email address is simply told their table (their sheet says *No email address*).
- While email is paused, the guest page says *Screenshot this screen to show the usher* instead of *We have emailed your table to you*, and the sheet says to tell the guest their table.

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

If the guest is not on the list, use **Add walk-in**; if they are here instead of an invitee, open the invitee and use **Record substitute** (see **Add a walk-in or record a substitute**). Both go to the Super Administrator to approve.

### The guest page

Each event has its own guest page, */event/* and the event's code (shown on **Event control**). It answers only while the event is *live*.

- Before the window opens it says *Registration opens at 6:00 PM.* and takes nothing.
- Once it is open, the guest types their **surname** and the **last 4 digits of their mobile** (or taps **Use email instead** and types their full email). Spaces, hyphens, accents and *Jr.* do not matter; the surname must be the one on the list.
- A match checks them in at once: *You're checked in. We're choosing your table.* The page then updates by itself, and shows **Table N** in large type and the seat as soon as staff seat them. After 4 minutes of waiting it adds *A staff member can help at the desk*. It keeps showing the table after a reload, and the last status while the phone is offline.
- Anything else gives the desk code (see **Help a guest who shows a code**).
- Checking in again from another phone shows the same status, never a second check-in; the guest's sheet then says *Verified again from another device* (the Super Administrator taps **Seen**). **End it on every device** on the sheet (the guest's owner) stops the page on a lost phone.
- After the doors, with **Self check-in open** turned off, the page sends everyone to the desk.

### Event control (Super Administrator)

Event control updates by itself, like My queue: the bar at the top says how old it is.

The **counts**: *Invited* (the guest list), *Checked in*, *Not yet arrived*, *Waiting for table*, *Needs approval* (walk-ins and substitutes to decide), *RSVP* (once invitations have gone: yes, no, no reply, opened) and *Seats left* (with how many are seated and reserved).

**Invitations**: see **Send the invitations**.

**Health** shows the change number, the **save time** (how long the last saves took, the 95th percentile: act if it is above 250 ms), the **email outbox** (how many seat emails wait or failed), the age of the newest **5-minute copy** of the event (written on the server every 5 minutes while the event is live, the last 24 kept), **too many requests** (how often the event's screens or the guest page were slowed down in the last 15 minutes) and the **seating rules** check (run every minute while live). A problem with the rules shows as a red banner here and in the Security monitor: call the on-call developer. A banner also appears when the guest page has had more than 30 failed checks in 5 minutes: nobody is locked out, but guests with a code will come to the desk.

**Exceptions** is your inbox, oldest first:

| It says | What to do |
|---|---|
| *Walk-in: …* | **Approve…** (class, industry, owner) or **Do not admit…** |
| *Seat 3-4: Juan Reyes replaces Pedro Reyes* (a substitute) | **Approve…** (give them the seat, or release it) or **Do not admit…** |
| *No seat in scope: …* | The guest's owner has no table that can take them. **Open** the guest and seat them yourself, or give the guest (or a table) to someone else |
| *No eligible seat left for …* | Every table of their type is full. Open a table, change one, or seat them as another class |
| *… arrived after their reservation was released* | **Open** and seat them |
| *Seat together (3): …* | A group sent by staff whose guests have different owners. **Seat together** |
| *Guest page paused for the surname …* | Too many different wrong numbers for one surname. **Clear**, or clear it at the desk |
| *Seat email to … failed* | The seat is safe. Tell the guest, or **Resend** |
| *… said Yes and has no seat yet* | No eligible chair was left, a preferred guest has no reservation, or **Seat on Yes** is off. **Open**, then **Reserve a seat…**: CORE emails them the table |
| *… said No and still holds …* | A reservation CORE never releases by itself. **Open** and **Release reservation** if they are not coming |
| *Invitation to … failed* | Check the address, then **Send again** |
| *… failed guest page checks in 5 minutes* | Nobody is locked out; guests with a code are helped at the desk |

The **room plan** on Event control works as on **Room plan**, for every table: choose a seated chair, then **Move** and an open chair to **transfer** the guest (*Move here*), or a seated guest's chair to **swap** them (*Swap seats*), **Back to waiting**, or, for a reserved chair, **Release reservation** (the confirm names the guest, the table and the chair). Every change shows on every device within a few seconds.

**Staff and their queues** shows each staff member's waiting guests, the longest wait, and when they last did anything. **All to…** gives all of one person's guests and tables to someone else at once (for example someone who is absent): their seats and check-ins stay as they are, and from that moment only the new owner (and you) can seat them. **One by one…** lists their waiting guests and their tables, each with its own **Move to…**.

**Tables: take out of use, or move their guests** (folded): a table with guests cannot be taken out of use (the button is greyed); **Move guests…** moves all of them to another table in one change, keeping their chair numbers where they are free, and can take the emptied table out of use at once.

**Switches** take effect on the next request, with no restart, and each change is in the audit log. Each asks you to confirm and says what it does:

- **Self check-in open**: lets guests check themselves in on the guest page while the event's window is open. It cannot be opened while the import check has issues, unless you acknowledge them.
- **Email paused**: assignments are shown on screen and told by staff; messages wait.
- **Read only**: nobody can check in or seat anyone until it is turned off. Use it while you reconcile paper.
- **Refresh interval**: how often staff screens ask for changes (2,000 ms is 2 seconds); a guest's page waiting for a table asks half as often, and once seated a fifth as often. Raise it (for example to 4,000) if the server is slow: it applies on every screen's next request.
- **Presence key on the reception QR**: off unless decided after the load test. When on, only a phone that scanned the reception QR printed with the key can check in; the key is shown once, so print **Reception QR sheet** when you turn it on.

**Reception QR sheet** prints the QR code of the guest page for the easel at reception, with *If this page doesn't open, please go to the registration desk.*

**Exports**: **Event export (JSON)** is the event's recovery copy (the format *customapp.event/1*, with its change number and a fingerprint); **Guests (CSV)** and **Seating (CSV)** open in Excel; **Printable seating plan** opens a page that prints cleanly: the room drawn as on the room plan, in black and white (the stage and tech booth, every table where it stands with its number, and its chairs with their numbers: a white chair is open, a hatched one reserved, a black one seated), then every table's chairs 1 to 10, stamped *As of* the time it was made. **Offline pack (print)** is what the desk works from if CORE cannot be reached (see **If the system is down**). Every download is in the audit log. **Seating rules check** checks every rule at once (no table over its chairs, no chair or guest counted twice, exactly one Super Administrator).

![The offline pack: the room, then an A–Z list and a sheet per table and per staff member](custom-app-events-pack.jpg)

**Hand over the Super Administrator** (administrators): choose the new Super Administrator, give the reason, enter your password. The current one loses every power at that moment; there is never more than one.

### Set up an event (Super Administrator)

1. **Room and tables**: the event's tables were made from its room when it was created (for example 5 rows × 5 columns of 10 chairs, stage on the right). Table 1 is nearest the stage, and tables run top to bottom, column by column, away from it; chair 1 faces the stage, and chairs run clockwise. **Edit** a table to set its type (*Preferred*, *Regular*, *Employee*, *Mixed*), chairs (1 to 10) and owner. A table with guests cannot be made smaller than them or taken out of use until they are moved. **Lay out the room again** works only while nobody has a seat.
2. **Staff**: tick the accounts on the event's staff and **Save staff**.
3. **Industries**: one per line, related ones after a colon (*Banking: Insurance, Real estate*); a relation is kept both ways.
4. **Event**: name, date, venue, the self check-in window (in Manila time), status (invitation links answer only while it is *Live*), **Email from** and **Reply-To** (the event's own address), and **Chair numbers** (every guest, preferred guests only, or tables only). **Mixed tables in use** lets anyone sit at tables marked *Mixed*. **Owners may release reservations** lets a table's owner release a reservation at their table; otherwise only you can.

### Import the guest list (Super Administrator)

1. In **Setup → Guest list**, click **Choose a file…** and pick the list, as CSV or Excel (.xlsx), up to 2,000 rows and 2 MB. The first row names the columns: *Ref*, *First name*, *Surname* (or *Name*), *Designation*, *Company*, *Industry*, *Email*, *Mobile*, *Classification* (preferred, regular, employee), *RSVP*, *Personnel* (the staff member's username), *Table* and *Seat* (a preferred guest's reserved chair).
2. Nothing is added yet. CORE shows what it read: new guests, guests to update, and anything to fix in the file first (an unknown classification, a table that does not exist, two guests for one chair, a table with more guests than chairs, more guests than the room seats). Fix those in the file and choose it again.
3. Click **Add N guests**. The whole list goes in at once.

Importing the list again updates guests by their *Ref*. Once the event is live, an import never changes anyone's check-in, seat or owner.

### Clear the import check (Super Administrator)

**Setup → Import check** lists guests self check-in could not tell apart or verify: two guests with the same surname and the same last 4 digits of their mobile, guests with no mobile and no email, possible duplicates, and industries not in the event's list. For each guest: **Add email**, **Add mobile**, or **Desk only** (they are checked in at the desk). **Acknowledge** accepts the rest. Self check-in stays closed until the list is clear or acknowledged.

### If the system is down

Keep calm: the paper pack and the export are the fallback, and nothing is lost by stopping.

**Before the doors**, the Super Administrator prints the **offline pack** (**Event control → Offline pack (print)**): the room drawn as on screen, an A–Z list of every guest with their table and chair, a sheet for each table (its chairs and who holds them) and a sheet for each staff member (their guests and tables). Every printed page says *as of* the time it was printed, so nobody works from an older sheet without knowing. Print it again closer to the doors if much has changed. Add `?standby=` and the standby address to the pack's address to print it on the desk card.

1. If CORE restarts, everyone is signed out: sign in again and you are back on your page.
2. If it stays down, work from the **offline pack**: each staff member seats only at their own tables (their own sheet), and writes down each arrival and seat with the time, on the line of the guest.
3. When CORE is back, the Super Administrator turns on **Read only** (nobody else changes anything meanwhile), opens **Event control → Reconcile paper seating** and types one line per paper entry: **time, ref, table, chair** (for example `19:05, DEMO-0054, 5, 3`; just the time and the ref for a check-in only). **Enter paper entries**.
4. Each line goes through the same rules as on screen. CORE says how many changes it entered and how many were already in. A line it cannot enter (the table is full, the chair was taken online, the guest was seated elsewhere online, the ref does not exist) comes back as a **card** saying why: nothing of it is entered, so paper can never overbook a table. Seat those guests on screen.
5. Entering the same sheet twice changes nothing the second time. Turn **Read only** off.

**The cards** (print them from here):

> **Easel card (under the QR code):** If this page doesn't open, please go to the registration desk.

> **Staff desk card:** Standby address: (written in by the on-call developer). If the app restarts you'll be signed out. Sign in again and you'll land back on your queue. If CORE cannot be reached, use the offline pack: seat only at your own tables, and write each arrival and seat with the time.

On the day (for the Super Administrator and the on-call developer):

- **Three hours before:** the deploy freeze is on; a fresh off-server backup is confirmed in the Security monitor; the standby is topped up; a test guest is checked in, seated (and their seat email arrives at the test address) and checked out again; the newest event export is under 5 minutes old and on the laptop; the offline pack is printed (every page stamped *as of*); staff devices are signed in, on the 4G hotspot, charged.
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
| **My queue** | Where Event staff start: your guests waiting for a table (oldest first, with how long; tick several to **Seat together**), those seated, Find guest and **Add walk-in**; it updates by itself |
| **Room plan** | The room with every table and chair; choose a waiting guest to see their best tables, then a chair, then **Seat here** |
| **Find guest** | Search by name, company or ref, filter by who is waiting, not arrived, seated or reserved, and by the answer to the invitation (**Said Yes**, **Said No**, **No reply**, **Not invited**); tap a guest to check them in, seat them, reserve a seat or record a substitute; **Add walk-in** |
| **Tables** | Every table with its type, owner and meter of chairs; tap one for its chairs and who sits on them |
| **Event control** | The counts, health, the **Exceptions** inbox (walk-ins, substitutes, groups, guests with no seat, failed emails, answers that need you), **Invitations** (settings, preview, test, send, every guest's RSVP), the room plan (move, swap, release), staff and their queues (**All to…**, **One by one…**), tables out of use, the switches and the reception QR, the exports, the printable seating plan and the offline pack, **Reconcile paper seating**, the seating rules check, handing over the Super Administrator |
| **Guest page** (*/event/…*) | Guests check themselves in on their phone and see their table; with their invitation link (*…#i=…*) they answer Yes or No, see their reserved seat, and check in at the door; no account |
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

**A guest's seat email failed. Is their seat still theirs?**
Yes. The seat and the check-in are saved before any email is sent, and nothing that happens to an email changes them. Tell the guest their table (or show them the guest page), and **Resend** when you can.

**Can someone seat a walk-in before the Super Administrator approves them?**
No. A walk-in or a substitute is not checked in, and no table takes them, until the Super Administrator approves; the guest page sends them to the desk.

**Can paper seating overbook a table?**
No. The Super Administrator enters the paper sheets through the same rules as the screens; a line that would put an eleventh guest at a table (or a second guest on a chair) is not entered and comes back as a card to resolve.

**A guest lost their invitation email. Can I send them the same link?**
No: CORE keeps only a fingerprint of each link, never the link itself, so nobody can read it back. **Send again** sends a new link and QR code; the old one stops working. Their answer and seat stay as they are.

**Does a seat reserved by a Yes run out?**
No. It is a reservation like any other: it holds the chair until the guest arrives, they say No (a seat their own Yes made is released then), or you release it. A preferred guest's reservation is never released by CORE, whatever they answer.

**Two guests said Yes to the last chair at once. Who got it?**
The one whose answer reached CORE first; the other was told *We will email your table* and is in **Exceptions**. A table never goes over its chairs.

**Does a guest have to answer the invitation to be let in?**
No. The answer is for planning. On the night anyone on the list is checked in, by their invitation link or by the surname check-in or at the desk.
