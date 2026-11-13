---
id: it-assets
title: Managing IT assets in CORE
summary: For IT asset managers: the asset register, assigning, transferring, returning and retiring equipment, consumable stock, problem reports from employees, allocations, the activity log and exports.
roles: it, support
apps: assets
order: 40
---

## Before you start

This guide is for **IT asset managers**: the people who register company equipment, hand it out, take it back, keep the spare-parts stock and answer employees who report a broken laptop. Service desk tickets are covered in [the service desk guide](service-desk). Your own equipment is under **My Assets** (see [My Assets: your own equipment](#my-assets-your-own-equipment)).

- Sign in and open the **IT Asset Management** tile on the home page. You land on the **Overview**.
- An **IT Asset Manager** account can do everything in this guide. **HR managers** and **Helpdesk agents** can open the same screens to look things up, but they cannot change anything or respond to problem reports.
- Every change is kept with your name and the time: on the asset's **History**, and in the **Activity log**.
- To try things out, load the demo data and sign in as `it.demo` (password `demo1234`). The demo has 16 assets, 7 inventory items and 2 problem reports.

## Walkthrough

A first tour with the demo data. It takes about ten minutes.

### The overview

1. Sign in as `it.demo` and open **IT Asset Management**. The **Overview** shows assets in service, assigned, available in stock, in repair, open problem reports, low-stock items and the asset value at cost.
2. Look at **Needs attention** on the right. It lists open problem reports, overdue returns, low stock and warranties ending within 60 days.
3. Scroll to **Recent activity** for the latest registrations, assignments and reports. **Full activity log →** opens the **Activity log**.

![The IT Asset Management overview](assets-overview.jpg)

### One asset and its history

1. Open **Assets**. The register lists every asset in service with its tag, status, holder, location, warranty and cost.
2. Click the first row, *DEMO-IT-0001 Dell Latitude 7440*. **Current holder** shows Maria Santos and since when she has it.
3. Scroll to **History**: when it was registered and when it was assigned, and by whom. **Export CSV** saves this history to a file.

![An asset with its current holder and history](assets-detail.jpg)

### Hand out a spare laptop

1. Go back to **Assets** and change the first filter to *In stock*. Click *DEMO-IT-0005 Dell Vostro 3520*.
2. Click **Assign**. Under **Allocate to**, choose **Employee**, **Department** or **Location**.
3. Pick the person (or type the department or location), add an **Expected return** date if it is a loan, and click **Assign**.

The status changes to *Assigned* and the assignment is added to the history.

![Assigning an asset to an employee, a department or a location](assets-assign.jpg)

### Stock and a problem report

1. Open **Inventory**. Rows in amber are at or below their reorder level and show **Low**.
2. Open **Problem reports**. *IR-0002* is new: Andrea Villanueva dropped her laptop and *Can't work on it*. Click the row to read the report, then see [Respond to a problem report](#respond-to-a-problem-report).
3. Open **Allocations** to see everything each person, department and location holds.

![Consumable stock, with low items flagged](assets-inventory.jpg)

## How to…

### Register an asset

1. Open **Assets** and click **+ Register asset** (also on the **Overview**).
2. Under **Identification**, leave **Asset tag** blank to use the next free tag, or type your own. Enter the **Name** and **Category** (both required), and the brand, model, serial number and specifications.
3. Under **Purchase, warranty and location**, enter the **Purchase date**, **Purchase cost (₱)**, **Supplier**, **Warranty ends**, **Condition** and **Storage location** (where it is kept when not assigned).
4. Click **Register asset**.

The asset opens with the status *In stock*. A serial number can be registered only once.

### Assign an asset to an employee, department or location

1. Open the asset (status *In stock*) and click **Assign**.
2. Under **Allocate to**, choose **Employee** and pick the person, or **Department** or **Location** and type its name.
3. Add an **Expected return** date for a loan, and **Notes** such as a ticket number.
4. Click **Assign**.

Employees are picked from the HR employee list. An asset assigned to an employee shows in their **My Assets** and on their employee record, and an employee with a CORE account is told by the **bell** in the top bar (*Ivan assigned LTDC-IT-0012 Dell Latitude 5440 to you*). Issuing stock to an employee tells them the same way. When the expected return date has passed, the asset shows *Overdue* and is listed on the **Overview**.

### Transfer an asset to someone else

1. Open the asset (status *Assigned*) and click **Transfer**.
2. Choose the new employee, department or location, and click **Transfer**.

The history shows *Transferred from … to …*. There is no need to return it to stock first.

### Take an asset back

1. Open the asset and click **Return**.
2. Under **Put back as**, choose *In stock (ready to reassign)* or *In repair*.
3. Set the **Condition**, where it is stored (**Store at**) and a note such as "missing charger".
4. Click **Record return**.

### Send for repair, retire or mark lost

1. Open the asset and click **Change status**.
2. Choose the **New status**: *In stock*, *In repair*, *Retired* or *Lost*. Add a note, for example a disposal reference or incident report number.
3. Click **Change status**.

An assigned asset can only be set to *Retired* or *Lost* here; this ends the assignment. To take it back normally, use **Return**. An asset that is *In repair* must be set back to *In stock* before it can be assigned again. Retired and lost assets leave the register; choose *All, incl. retired and lost* in the status filter to see them.

### Edit or delete an asset

1. Open the asset and click **Edit**. Change the details and click **Save changes**.
2. To delete an asset, scroll to the bottom and click **Delete asset**. This is possible only when it is not assigned, and it deletes its history too.

> **Tip:** For equipment that was disposed of, set the status to *Retired* instead of deleting it. The history is kept.

### Find assets and export the register

1. Open **Assets**. Type in the search box to find a tag, name, serial number, holder or location.
2. Filter by status, category and holder type (**Any holder**, *Employee*, *Department*, *Location*).
3. Click **Export CSV**. The file holds the assets you see, with every detail.

### Add a stock item

1. Open **Inventory** and click **+ Add item**.
2. Leave **SKU** blank for the next free code, enter the **Item name**, **Category**, **Unit** (pcs, boxes, bottles) and the **Reorder level**. An item is flagged as low at or below this number.
3. Enter the **Location**, **Unit cost (₱)**, **Supplier** and the **Opening quantity** you have now.
4. Click **Add item**.

### Receive, issue and count stock

1. Open **Inventory**. On the item's row, click **Receive**, **Issue** or **Count**. The same buttons are on the item's own page.
2. **Receive**: enter the **Quantity** and a **Reference** such as the delivery receipt or PO number. Click **Add to stock**.
3. **Issue**: enter the **Quantity**, choose who it goes to under **Issue to** (employee, department or location) and a reference such as the request or ticket number. Click **Issue**. You cannot issue more than is on hand.
4. **Count**: after a physical count, enter the **Counted quantity**. The difference is saved as a *Count adjustment*. Click **Save count**.

Each movement is listed on the item's page under **Movements**, with the balance after it and who made it.

![Issuing stock to an employee](assets-issue.jpg)

An item can be deleted (**Delete item**, on its page) only when its stock is zero. Its movements stay in the activity log.

### Respond to a problem report

Employees report equipment that is malfunctioning, damaged, lost or stolen from their **My Assets**. New reports show a count next to **Problem reports** in the menu.

1. Open **Problem reports**. It shows open reports (*New* and *Being checked*) first. Click a row.
2. Read **The problem**, whether they can still work on it, and the warranty under **Equipment**. **Open asset** takes you to the asset.
3. Under **Update the employee**, set the **Status** (*New*, *Being checked*, *Resolved*, *Closed*) and write a note. The employee reads it in **My Assets**.
4. Click **Save update**.

![A problem report from an employee](assets-report.jpg)

To take the laptop in for repair, open the asset and use **Return** with *In repair*. Give a loaner with **Assign** on a spare. An employee can have only one open report per asset; once it is resolved or closed they can report it again.

### See who holds what

1. Open **Allocations**. Each card is one employee, department or location, with the assets it holds and the consumables issued to it.
2. Search for a person, tag or asset, or filter by **Employees**, **Departments** or **Locations**.
3. Click **Export CSV** for the full list, for example before someone leaves the company.

![Allocations by holder](assets-allocations.jpg)

### Check the activity log

1. Open **Activity log**. It shows the last 30 days.
2. Change **From** and **To**, and choose *Assets only* or *Inventory only* if you like.
3. Click a tag or SKU to open the asset or item. **Export CSV** saves the list.

### My Assets: your own equipment

**My Assets** is under **My account** in the menu when your sign-in account is linked to your employee record. It shows the equipment assigned to you, your problem reports and the supplies issued to you. This is the same screen every employee sees.

![My Assets, as an employee sees it](assets-my-assets.jpg)

1. To report a problem with your own equipment, click **Report a problem** on its card.
2. Choose **What's wrong?**, **Can you still work on it?**, describe the problem and click **Send report**.

If **My Assets** is missing from your menu, ask HR to link your account to your employee record. See [the employee guide](employee) for more.

## Screens at a glance

| Screen | What it is for |
|---|---|
| Overview | Totals, assets by category, and what needs attention: problem reports, overdue returns, low stock, warranties ending soon |
| Assets | The asset register: register, assign, transfer, return, change status, history, CSV export |
| Inventory | Consumables and spare parts: receive, issue, count, movements, CSV exports |
| Problem reports | Equipment problems reported by employees, and your updates to them |
| Allocations | Every employee, department and location with what it holds; CSV export |
| Activity log | Every asset and stock event in a date range; CSV export |
| My Assets | Your own equipment, problem reports and issued supplies |

## Questions

**What is the difference between an asset and an inventory item?**
An asset is one tracked piece of equipment with its own tag and serial number, such as a laptop. An inventory item is a consumable or spare part counted by quantity, such as adapters or ink.

**Why can't I assign this asset?**
Only assets that are *In stock* (or already *Assigned*, to transfer them) can be assigned. Set an asset that is *In repair* back to *In stock* with **Change status** first.

**Where do the numbers on the overview come from?**
**Assets in service** leaves out retired and lost assets. **Asset value (cost)** adds up the purchase cost of the assets in service.

**An employee is leaving. How do I see what they have?**
Search for them in **Allocations**, or ask HR: the employee record shows the assets they hold, with a reminder if the person is inactive.

**Does an employee get an email when I update their report?**
No. They see your note and the new status in **My Assets**.

**Can I undo a return or a transfer?**
Not directly. Assign or transfer the asset again. Both steps stay in the history.
