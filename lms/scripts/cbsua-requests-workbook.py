# Builds ATLAS_vs_CBSUA_EndUser_Requests.xlsx: CBSUA's punch list joined with the council's maps.
import re, sys
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.formatting.rule import FormulaRule

SRC = sys.argv[1]
import os
MAT = os.environ.get('MATRIX_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'council', '2026-11-cbsua-requests', 'matrix')) + '/'
OUT = sys.argv[2]

def clean(s):
    s = re.sub(r'\*\*(.+?)\*\*', r'\1', s or '')
    s = s.replace('`', '').replace('<br>', '\n').strip()
    return '' if s in ('—', '-') else s

def rows_of(md):
    out = {}
    for line in open(MAT + md, encoding='utf-8'):
        m = re.match(r'^\|\s*((?:LMS-|UIS-|X-)?PL-\d+)\s*\|(.*)\|\s*$', line)
        if not m: continue
        cells = [c.strip() for c in re.split(r'(?<!\\)\|', m.group(2))]
        if len(cells) < 6: continue
        out[m.group(1)] = dict(area=clean(cells[0]), request=clean(cells[1]), status=clean(cells[2]), where=clean(cells[3]), meet=clean(cells[4]), effort=clean(cells[5]))
    return out

def section(md, title):
    text = open(MAT + md, encoding='utf-8').read()
    m = re.search(r'^## ' + re.escape(title) + r'.*?$(.*?)(?=^## |\Z)', text, re.S | re.M)
    return m.group(1).strip() if m else ''

maps = {'HRIS': rows_of('hris.md'), 'FMIS': rows_of('fmis.md')}
al = rows_of('academic-lms.md')
maps['LMS'] = {k[4:]: v for k, v in al.items() if k.startswith('LMS-')}
maps['UIS'] = {k[4:]: v for k, v in al.items() if k.startswith('UIS-')}
maps['Cross-System'] = {k[2:]: v for k, v in al.items() if k.startswith('X-')}

# Council plan per item
DECLINED = {('LMS', 'PL-07'), ('LMS', 'PL-09'), ('LMS', 'PL-14'), ('HRIS', 'PL-041'), ('FMIS', 'PL-65'), ('FMIS', 'PL-79'), ('FMIS', 'PL-71'), ('FMIS', 'PL-78'), ('UIS', 'PL-10'), ('UIS', 'PL-52')}
DECLINE_NOTE = {
    ('LMS', 'PL-07'): 'Declined: one ATLAS account per person; People is the source for faculty, Learn roles in the Admin panel.',
    ('LMS', 'PL-09'): 'Declined: one ATLAS account per person; Learn roles kept in the Admin panel.',
    ('LMS', 'PL-14'): 'Declined as asked: no lockdown browser or webcam. Instead: time limits, shuffled questions, page-leave logs disclosed to students; Safe Exam Browser possibly later, opt-in per exam.',
    ('HRIS', 'PL-041'): 'Declined: no auto-approval. Reminders, then escalation to the next officer.',
    ('FMIS', 'PL-65'): 'Partly declined: accounts with balances or use are deactivated, not deleted; unused accounts can be hidden.',
    ('FMIS', 'PL-79'): 'Declined: posted or cancelled entries are never deleted; hidden from the default lists instead.',
    ('FMIS', 'PL-71'): 'Redesigned: "Copy as a new draft" instead of reopening a cancelled beginning balance.',
    ('FMIS', 'PL-78'): 'Redesigned: "Copy as a new draft" instead of reopening a cancelled JEV; a prior-period entry once statements are issued.',
    ('UIS', 'PL-10'): 'Redesigned: the administrator configures the grade-change route but is never a step in it.',
    ('UIS', 'PL-52'): 'Redesigned pending DPO and legal office: hold release of official documents (TOR, certifications), not the student\'s view of own grades.',
}
DECISION = {
    ('FMIS', 'PL-30'): 'Decision needed: a draft PO without a supplier is fine; an approved PO needs one.',
    ('FMIS', 'PL-47'): 'Decision needed: ACIC changes need the COA auditor\'s and the bank\'s written agreement.',
    ('FMIS', 'PL-48'): 'Decision needed: ACIC changes need the COA auditor\'s and the bank\'s written agreement.',
    ('FMIS', 'PL-49'): 'Decision needed: removing ACIC signature lines needs COA\'s written agreement.',
    ('FMIS', 'PL-50'): 'Decision needed: ACIC changes need the COA auditor\'s and the bank\'s written agreement.',
    ('UIS', 'PL-24'): 'Decision needed: the Accounting Office confirms whether the doc stamp line is proof of documentary stamp tax paid.',
    ('HRIS', 'PL-035'): 'Decision needed: SALN out of the pilot; the DPO decides whether ATLAS holds SALNs.',
}
def ids(tab, *rng):
    out = set()
    for a in rng:
        if isinstance(a, tuple):
            for n in range(a[0], a[1] + 1): out.add((tab, fmt(tab, n)))
        else: out.add((tab, fmt(tab, a)))
    return out
def fmt(tab, n): return f'PL-{n:03d}' if tab == 'HRIS' else f'PL-{n:02d}'
NEW_MODULE = {}
for k in ids('HRIS', 3, 4, (15, 23), 25, (27, 29), 31, 32): NEW_MODULE[k] = 'Recruitment / PDS / plantilla wave'
for k in ids('HRIS', 14, 34, 53): NEW_MODULE[k] = 'Service record and plantilla register wave'
for k in ids('HRIS', 54, 55, 56, 58): NEW_MODULE[k] = 'L&D, SPMS/IPCR and rewards wave'
for k in ids('FMIS', 4, 22, (24, 28), 119): NEW_MODULE[k] = 'PPMP / APP wave'
for k in ids('FMIS', 5, 113, 114, 115): NEW_MODULE[k] = 'Procurement pipeline wave'
for k in ids('FMIS', 94): NEW_MODULE[k] = 'Year-end statements (Cash Flows, Notes)'
for k in ids('UIS', 11, 26, 28, 29, 38, 39, 51): NEW_MODULE[k] = 'Fees and FHE (UniFAST, RA 10931) wave'
for k in ids('UIS', 33, 44): NEW_MODULE[k] = 'Form 137 (with document templates)'

def plan(tab, iid, status, full=''):
    k = (tab, iid)
    built = re.search(r'\b(20\d\d-\d\d-\d\d)\b', full or '')
    if k in DECLINED: return 'Declined / redesigned', DECLINE_NOTE[k]
    if k in DECISION: return 'Decision needed', DECISION[k]
    s = status.lower()
    if s.startswith('has'): return 'No build needed', (f'Built in ATLAS on {built.group(1)}; show it in the office demo.' if built else 'ATLAS already does this; show it in the office demo.')
    if s.startswith('configurable'): return 'No build needed', 'Already an admin setting in ATLAS; set it during onboarding.'
    if s.startswith('not atlas'): return 'No build needed', 'About the current vendor\'s own system; see the ATLAS note for the matching safeguard.'
    if k in NEW_MODULE: return 'New module (later wave)', NEW_MODULE[k]
    return 'Configuration / build', ''

CHANGES = [
    ('2026-11-26', 'HRIS PL-016', 'Applicant sign-up fields: HR shows, hides or requires each optional field (mobile, sex, date of birth, home address, highest education, preferred campus = the "branch"); only the mobile number is shown by default; document uploads and an employee ID are never asked at sign-up. PL-016 now Has.'),
    ('2026-11-26', 'HRIS PL-015', 'Application progress tracker in People: applicants (and employees who applied) see the recruitment stages with dates, what happens at the current stage, HR\'s notes (from "HR office") and the outcome; the bell links to it. Stages are configurable with fixed meanings (HR settings -> Recruitment stages): default Application received, Initial screening, Assessment (examination or interview), Deliberation, Final decision; outcomes Selected, Not qualified, Not selected, Withdrawn. HR moves applications forward, back one stage with a reason, or to an outcome, singly or in bulk, with a note and an internal remark. Earlier statuses migrated. PL-015 now Has; default stages to confirm against the school\'s merit selection plan.'),
    ('2026-11-26', 'HRIS PL-014 (also PL-027, PL-045)', 'Plantilla register in People: one record per DBM item number (recorded as issued) with position, salary grade, authorized and actual annual salary, office, campus, fund source and status (Filled, Vacant, Unfunded, Abolished); the incumbent is linked to the employee record; filters, totals, CSV and a printable PSIPOP (Legal landscape). Columns to confirm against HR\'s PSIPOP sample. Vacant items can post a job opening (PL-027); items carry a fund source (PL-045 now Partly).'),
    ('2026-11-26', 'HRIS PL-003, PL-004 (also PL-015, 027, 028, 029)', 'Recruitment, first slice in People: HR posts job openings (salary from the salary grade, plantilla item, CSC qualification standards, Internal only or Open to all) and follows applications with a status; outsiders sign up with basic details for a temporary applicant account (365 days by default, warned before, closed, then removed; Selected applicants kept); employees apply internally with their own account (PL-004 redesigned: no second account). PL-003, 004 and 028 now Has; 015, 027 and 029 Partly.'),
    ('2026-11-26', 'UIS PL-16, 37, 49; HRIS PL-026', 'School branding: the whole app can lead with the school (Branding -> "Our school, powered by ATLAS"). Notes added; statuses unchanged.'),
    ('2026-11-25', 'All 269', 'First version: every item mapped against ATLAS and reviewed by the council.'),
]
BRAND_NOTE = 'Update 2026-11-26: the whole app can now lead with the school (Admin panel -> Settings & branding -> Branding -> "Our school, powered by ATLAS"): seal, short name and colours in the top bar, sign-in pages, system names and icons.'
UPDATES = {('UIS', 'PL-16'): BRAND_NOTE + ' Several logos on one document still wait for document templates.',
           ('UIS', 'PL-37'): BRAND_NOTE, ('UIS', 'PL-49'): BRAND_NOTE,
           ('HRIS', 'PL-026'): BRAND_NOTE + ' Letterhead lines still wait for document templates.'}

# How to use each update, step by step (from the Help guides). Shown in the "How to use it" column.
BRANDING_FLOW = ('Administrator (Admin panel):\n1. Settings & branding -> Branding -> Brand: choose "Our school, powered by ATLAS".\n2. Type the school short name (e.g. CBSUA).\n3. Upload logo: the school seal (square, transparent background).\n4. Colours: School colour and Accent (e.g. green #126131, gold #EDE344); check the Preview.\n5. Save settings: the top bar, sign-in pages, system names and icons now show the school.\nHelp: Administrator guide -> "Lead with your school\'s name and seal".')
HOW_TO = {
    ('HRIS', 'PL-003'): 'HR (People):\n1. HR settings -> Job applicants: set how many days applicant accounts last (365 by default, 30-1095), the warning days (30) and the removal days after closing (30; 0 = keep).\n2. Save HR settings.\n3. Recruitment -> Applicant accounts: see each account\'s closing date; Extend (days to add) or Remove.\nApplicant: sees "Your applicant account is open until ..." on Job openings and My applications, and a bell notice before it closes.\nHelp: HR guide -> "Extend or remove an applicant account"; Applicant guide -> "Know when your account closes".',
    ('HRIS', 'PL-004'): 'Employee (People, own account):\n1. People -> Job openings (under Me): openings open to everyone and those marked Internal only.\n2. Choose the opening, read the salary and qualification standards.\n3. Apply -> Cover note -> Send application. It is marked Internal and linked to the employee record.\n4. My applications -> See its progress.\nHR: to post an opening for employees only, set Who may apply = Internal only.\nHelp: Employee guide -> "Apply for a job opening".',
    ('HRIS', 'PL-014'): 'HR (People -> Plantilla):\n1. Record an item: item number exactly as DBM issued it, position title, salary grade (authorized annual salary fills in), campus and office, fund source and PSIPOP codes, status, date created and authority. Record item.\n2. Open a vacant item -> Link an incumbent -> pick the employee -> Link (the item becomes Filled).\n3. Filters (campus, office, fund source, status, salary grade) and totals; Export CSV.\n4. Print PSIPOP -> choose the As of date -> Print on Legal paper, landscape.\n5. Items brought over from employee records: "Show them" -> check against DBM\'s list -> Mark as reviewed.\nHelp: HR guide -> "The plantilla register", "Record a plantilla item", "Print the PSIPOP".',
    ('HRIS', 'PL-015'): 'HR (People -> Recruitment -> Job openings -> an opening):\n1. On an applicant\'s row choose Move -> pick the next stage or a final outcome -> Note to the applicant (optional) -> Internal remark (optional, HR only) -> Save and tell the applicant.\n2. Several at once: tick them -> Move chosen... -> stage -> one note -> Move and tell the applicants.\n3. Back one stage: Move -> Back to ... -> reason (required).\n4. Stages themselves: HR settings -> Recruitment stages (label, what the applicant reads, order, retire) -> Save recruitment stages.\nApplicant / employee: My applications -> See its progress: the stages with dates, what happens now, and the notes from HR. Each change arrives on the bell.\nHelp: HR guide -> "Move an application to another stage", "Set the recruitment stages"; Applicant guide -> "Follow your application".',
    ('HRIS', 'PL-016'): 'HR (People):\n1. HR settings -> Applicant sign-up fields.\n2. For each field (mobile, sex, date of birth, home address, highest education, preferred campus) choose Hidden, Optional or Required.\n3. Save HR settings. The sign-up form and its privacy notice follow at once.\nDocument uploads and an employee ID are never asked at sign-up.\nHelp: HR guide -> "Choose what the applicant sign-up asks".',
    ('HRIS', 'PL-028'): 'Applicant (ATLAS home):\n1. Job openings -> Sign up to apply.\n2. Full name, email, (mobile and any field HR turned on), username, password.\n3. Read Your privacy -> tick I have read this notice -> Create my applicant account.\nHR chooses the extra fields: see PL-016.\nHelp: Applicant guide -> "Sign up for an applicant account".',
    ('HRIS', 'PL-027'): 'HR (People):\n1. Recruitment -> Job openings -> New opening, or Plantilla -> a vacant item -> Post a job opening (item no., title, salary grade, campus and office filled in).\n2. Salary grade: the monthly salary shows and applicants see it. Fill in the qualification standards, vacancies, closing date, Who may apply.\n3. Status Open -> Save opening.\nStill to come: the CSC publication print format.\nHelp: HR guide -> "Post a job opening".',
    ('HRIS', 'PL-029'): 'Applicant flow today: ATLAS home -> Job openings -> Sign up to apply -> choose an opening -> Apply -> My applications -> See its progress. To be reviewed with HR and real applicants.\nHelp: Applicant guide (Walkthrough).',
    ('HRIS', 'PL-045'): 'HR (People -> Plantilla): each item\'s fund source (fund cluster and program/activity/project) is set when recording or editing it; filter the register and the PSIPOP by fund source. Still to come: payroll filtering and the ORS split by fund.',
    ('HRIS', 'PL-026'): BRANDING_FLOW,
    ('UIS', 'PL-16'): BRANDING_FLOW,
    ('UIS', 'PL-37'): BRANDING_FLOW,
    ('UIS', 'PL-49'): BRANDING_FLOW,
}
# ---------- read the original workbook ----------
wb_in = openpyxl.load_workbook(SRC, data_only=True)
COLS_STD = ('A', 'B', 'C', 'D', 'E', 'F')  # id, module, user, category, description, priority
records = []
for ws in wb_in.worksheets:
    tab = ws.title
    for r in range(5, ws.max_row + 1):
        iid = ws[f'A{r}'].value
        if not iid or not str(iid).startswith('PL-'): continue
        if tab == 'Cross-System':
            module, user, cat, desc, prio = ws[f'B{r}'].value, '', ws[f'C{r}'].value, ws[f'D{r}'].value, ws[f'E{r}'].value
        else:
            module, user, cat, desc, prio = (ws[f'{c}{r}'].value for c in ('B', 'C', 'D', 'E', 'F'))
        m = maps.get(tab, {}).get(str(iid).strip())
        if not m:
            print('NO MAP ROW', tab, iid); m = dict(area='', request='', status='Not mapped', where='', meet='', effort='')
        raw = re.sub(r'\s*\(.*$', '', m['status']).strip() or m['status']
        status = next((x for x in ('Has', 'Configurable', 'Partly', 'Missing', 'Not ATLAS') if raw.lower().startswith(x.lower())), raw)
        p, note = plan(tab, str(iid).strip(), status, m['status'])
        upd = UPDATES.get((tab, str(iid).strip()))
        if upd: note = (note + ' ' if note else '') + upd
        records.append(dict(howto=HOW_TO.get((tab, str(iid).strip()), ''), tab=tab, id=str(iid).strip(), module=module or '', user=user or '', cat=cat or '', desc=str(desc or '').strip(), prio=prio or '',
                            status=status, status_full=m['status'], where=m['where'], meet=m['meet'], effort=m['effort'], plan=p, note=note, area=m['area']))

# ---------- styles ----------
MAROON = '5D0013'
HEAD = Font(bold=True, color='FFFFFF', name='Calibri', size=11)
HEAD_FILL = PatternFill('solid', fgColor=MAROON)
TITLE = Font(bold=True, size=16, color=MAROON)
SUB = Font(italic=True, size=10, color='555555')
WRAP = Alignment(wrap_text=True, vertical='top')
CENTER = Alignment(horizontal='center', vertical='top', wrap_text=True)
thin = Side(style='thin', color='D9D9D9')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
STATUS_FILL = {'Has': 'C6EFCE', 'Configurable': 'B7E1E6', 'Partly': 'FFEB9C', 'Missing': 'FFC7CE', 'Not ATLAS': 'E7E6E6'}
PLAN_FILL = {'No build needed': 'C6EFCE', 'Configuration / build': 'FFF2CC', 'New module (later wave)': 'F8CBAD', 'Declined / redesigned': 'D9D2E9', 'Decision needed': 'BDD7EE'}

wb = openpyxl.Workbook()
# ---------- Summary ----------
ws = wb.active
ws.title = 'Summary'
ws['A1'] = 'CBSUA end-user requests vs Lancaster ATLAS'
ws['A1'].font = TITLE
ws['A2'] = 'Source: CBSUA punch list from the October 15, 2026 demos of the current vendor\'s systems (269 items). Coverage checked against the ATLAS code; updated 2026-11-26 (version 0.8.0-alpha). Changes since the first version: sheet "Change log". Council recommendations: lms/docs/council/2026-11-cbsua-requests/README.md.'
ws['A2'].font = SUB
ws.merge_cells('A2:H2'); ws['A2'].alignment = WRAP; ws.row_dimensions[2].height = 45
tabs = ['HRIS', 'FMIS', 'LMS', 'UIS', 'Cross-System']
statuses = ['Has', 'Configurable', 'Partly', 'Missing', 'Not ATLAS']
r0 = 4
ws.cell(r0, 1, 'ATLAS coverage today').font = Font(bold=True, size=12, color=MAROON)
hdr = ['Tab'] + statuses + ['Total', 'Covered now (Has + Configurable)']
for j, h in enumerate(hdr, 1):
    c = ws.cell(r0 + 1, j, h); c.font = HEAD; c.fill = HEAD_FILL; c.alignment = CENTER; c.border = BORDER
for i, t in enumerate(tabs + ['All'], r0 + 2):
    ws.cell(i, 1, t).font = Font(bold=(t == 'All'))
    ws.cell(i, 1).border = BORDER
    for j, s in enumerate(statuses, 2):
        if t == 'All':
            col = get_column_letter(j); v = f'=SUM({col}{r0+2}:{col}{i-1})'
        else:
            v = f'=COUNTIFS(\'All items\'!$A:$A,"{t}",\'All items\'!$H:$H,"{s}")'
        c = ws.cell(i, j, v); c.alignment = CENTER; c.border = BORDER; c.fill = PatternFill('solid', fgColor=STATUS_FILL[s])
    tot = ws.cell(i, 7, f'=SUM(B{i}:F{i})'); tot.alignment = CENTER; tot.border = BORDER; tot.font = Font(bold=True)
    cov = ws.cell(i, 8, f'=IFERROR((B{i}+C{i})/G{i},0)'); cov.number_format = '0%'; cov.alignment = CENTER; cov.border = BORDER
    if t == 'All':
        for j in range(1, 9): ws.cell(i, j).font = Font(bold=True)

r1 = r0 + 10
ws.cell(r1, 1, 'Council plan per item').font = Font(bold=True, size=12, color=MAROON)
plans = list(PLAN_FILL)
for j, h in enumerate(['Tab'] + plans + ['Total'], 1):
    c = ws.cell(r1 + 1, j, h); c.font = HEAD; c.fill = HEAD_FILL; c.alignment = CENTER; c.border = BORDER
for i, t in enumerate(tabs + ['All'], r1 + 2):
    ws.cell(i, 1, t).border = BORDER
    for j, p in enumerate(plans, 2):
        v = f'=SUM({get_column_letter(j)}{r1+2}:{get_column_letter(j)}{i-1})' if t == 'All' else f'=COUNTIFS(\'All items\'!$A:$A,"{t}",\'All items\'!$M:$M,"{p}")'
        c = ws.cell(i, j, v); c.alignment = CENTER; c.border = BORDER; c.fill = PatternFill('solid', fgColor=PLAN_FILL[p])
    c = ws.cell(i, 7, f'=SUM(B{i}:F{i})'); c.alignment = CENTER; c.border = BORDER; c.font = Font(bold=True)
    if t == 'All':
        for j in range(1, 8): ws.cell(i, j).font = Font(bold=True)

r2 = r1 + 10
ws.cell(r2, 1, 'How to read the columns').font = Font(bold=True, size=12, color=MAROON)
legend = [
    ('Has', 'ATLAS already does this as asked.'),
    ('Configurable', 'An administrator can already set this in ATLAS.'),
    ('Partly', 'ATLAS does part of it; the "What is needed" column says what is missing.'),
    ('Missing', 'ATLAS does not do this yet.'),
    ('Not ATLAS', 'About the current vendor\'s own bug, data or rollout; the ATLAS note says whether ATLAS gets it right.'),
    ('Effort', 'S = days, M = 1–2 weeks, L = more than 2 weeks (estimate, before CBSUA\'s samples).'),
    ('No build needed', 'Has, Configurable or Not ATLAS: answered by a demo or by onboarding settings.'),
    ('Configuration / build', 'Met mainly through ATLAS\'s planned configuration features (templates, number series, lists, routes, grading, imports, reports) or small builds.'),
    ('New module (later wave)', 'A new module to scope and price separately (recruitment, PDS/plantilla, L&D/SPMS, SALN, PPMP/APP and procurement, fees/FHE, Form 137, year-end statements).'),
    ('Declined / redesigned', 'Not built as asked; an alternative is offered (see the note).'),
    ('Decision needed', 'Needs a written decision from CBSUA, COA, the DPO or the office before building.'),
]
for i, (k, v) in enumerate(legend, r2 + 1):
    a = ws.cell(i, 1, k); a.font = Font(bold=True)
    fill = STATUS_FILL.get(k) or PLAN_FILL.get(k)
    if fill: a.fill = PatternFill('solid', fgColor=fill)
    b = ws.cell(i, 2, v); ws.merge_cells(start_row=i, start_column=2, end_row=i, end_column=8); b.alignment = WRAP
    ws.row_dimensions[i].height = 30
ws.column_dimensions['A'].width = 26
for col in 'BCDEFG': ws.column_dimensions[col].width = 16
ws.column_dimensions['H'].width = 22
ws.sheet_view.showGridLines = False

# ---------- item sheets ----------
COLS = [('Tab', 11), ('Item ID', 10), ('Module / topic', 22), ('Requested by', 20), ('Original request', 48), ('Priority', 10),
        ('ATLAS area', 20), ('ATLAS covers it?', 14), ('Where in ATLAS today', 48), ('What is needed', 52), ('Effort', 8), ('Council note', 44), ('Council plan', 20), ('How to use it (updates)', 60),
        ('CBSUA comments', 30), ('LTDC response / target', 30)]

def item_sheet(name, recs):
    ws = wb.create_sheet(name)
    for j, (h, w) in enumerate(COLS, 1):
        c = ws.cell(1, j, h); c.font = HEAD; c.fill = HEAD_FILL; c.alignment = CENTER; c.border = BORDER
        ws.column_dimensions[get_column_letter(j)].width = w
    # Column order in the sheet: Tab, ID, Module, User, Request, Priority, Area, Status, Where, Meet, Effort, Note, Plan, comments...
    for i, x in enumerate(recs, 2):
        module = ' / '.join(v for v in (str(x['module']), str(x['cat'])) if v and v not in ('None',))
        vals = [x['tab'], x['id'], module, x['user'], x['desc'], x['prio'], x['area'], x['status'], x['where'], x['meet'], x['effort'], x['note'], x['plan'], x['howto'], '', '']
        for j, v in enumerate(vals, 1):
            c = ws.cell(i, j, v); c.alignment = WRAP; c.border = BORDER
        for j in (2, 6, 8, 11): ws.cell(i, j).alignment = CENTER
        s = ws.cell(i, 8); s.fill = PatternFill('solid', fgColor=STATUS_FILL.get(x['status'], 'FFFFFF')); s.font = Font(bold=True)
        p = ws.cell(i, 13); p.fill = PatternFill('solid', fgColor=PLAN_FILL.get(x['plan'], 'FFFFFF'))
        if x['howto']: ws.cell(i, 14).fill = PatternFill('solid', fgColor='E2EFDA')
    ws.freeze_panes = 'C2'
    last = len(recs) + 1
    tname = re.sub(r'[^A-Za-z]', '', name) or 'Items'
    t = Table(displayName=f'T_{tname}', ref=f'A1:{get_column_letter(len(COLS))}{last}')
    t.tableStyleInfo = TableStyleInfo(name='TableStyleLight1', showRowStripes=False)
    ws.add_table(t)
    ws.sheet_view.zoomScale = 90
    return ws

item_sheet('All items', records)
for t in tabs: item_sheet(t, [x for x in records if x['tab'] == t])

# ---------- Declined & decisions ----------
ws = wb.create_sheet('Declined & decisions')
hdr = [('Tab', 11), ('Item ID', 10), ('Original request', 55), ('Council plan', 20), ('What ATLAS offers instead / what is needed', 70)]
for j, (h, w) in enumerate(hdr, 1):
    c = ws.cell(1, j, h); c.font = HEAD; c.fill = HEAD_FILL; c.alignment = CENTER; c.border = BORDER
    ws.column_dimensions[get_column_letter(j)].width = w
i = 2
for x in records:
    if x['plan'] in ('Declined / redesigned', 'Decision needed'):
        for j, v in enumerate([x['tab'], x['id'], x['desc'], x['plan'], x['note']], 1):
            c = ws.cell(i, j, v); c.alignment = WRAP; c.border = BORDER
        ws.cell(i, 4).fill = PatternFill('solid', fgColor=PLAN_FILL[x['plan']])
        i += 1
ws.freeze_panes = 'A2'

# ---------- ATLAS issues found ----------
ws = wb.create_sheet('ATLAS issues found')
issues = [
    ('F1', 'People', 'Legal pay parameters (GSIS shares, ECC, PERA, overtime, tax-exempt ceiling, cash gift, PEI, clothing) are plain settings an administrator can change; tardiness can be taken from salary before vacation leave.', 'Dated tables citing their circular, shipped by LTDC; any override needs a reason, a second approver and a log entry.'),
    ('F2', 'People', 'Flexible time is never charged undertime (a 6-hour day is paid as 8); the late grace period is a free setting; a remote day counts as a full day without an accomplishment report.', 'Charge undertime against the 8-hour day within the flexi band; remove the free grace period; require the WFH accomplishment report.'),
    ('F3', 'People', '"SPL" is seeded as Solo Parent Leave (CSC: Special Privilege Leave); no Forced or Wellness Leave; private-sector Emergency Leave included; credits given yearly, not accrued monthly; CSC late/undertime conversion drifts from the table.', 'A CSC leave preset with fixed internal ids and editable labels; monthly accrual; the CSC conversion table as fixed code.'),
    ('F4', 'Finance', 'Reprinted Finance documents (e.g. a posted JEV) show today\'s signatories instead of those at signing.', 'Freeze signatories and printed lines when a document is signed or posted.'),
    ('F5', 'Finance / all', 'Two numbering engines that disagree; Finance\'s does not check numbers already used; a month token forces a monthly reset (cause of FMIS PL-38/40).', 'One numbering engine with a reset period separate from the format.'),
    ('F6', 'Finance', 'ADA Disbursement Journal (GAM App. 52) missing; bank reconciliation has App. 81 only (no App. 80 for the MDS account); liquidations post to the General Journal.', 'Add the ADA journal and App. 80; post liquidations to the Cash Disbursement Journal.'),
    ('F7', 'System', 'The settings change log keeps only 5,000 entries and cannot undo values over 20 kB; the settings import rolls back from a snapshot.', 'An uncapped, append-only change log and transactional imports with the storage move.'),
    ('F8', 'Academic', 'The public document check (/verify) shows the GWA.', 'For the DPO to decide; possibly show only that the document is genuine.'),
    ('F9', 'People', 'No Daily Time Record printout (CS Form 48), which COA requires.', 'Add the DTR printout on the document template engine.'),
]
hdr = [('#', 6), ('Area', 14), ('Issue in ATLAS today', 80), ('Recommended fix (awaiting approval)', 70)]
for j, (h, w) in enumerate(hdr, 1):
    c = ws.cell(1, j, h); c.font = HEAD; c.fill = HEAD_FILL; c.alignment = CENTER; c.border = BORDER
    ws.column_dimensions[get_column_letter(j)].width = w
for i, row in enumerate(issues, 2):
    for j, v in enumerate(row, 1):
        c = ws.cell(i, j, v); c.alignment = WRAP; c.border = BORDER
ws.freeze_panes = 'A2'

# ---------- Questions for CBSUA ----------
ws = wb.create_sheet('Questions for CBSUA')
hdr = [('Area', 14), ('Question / sample needed', 110), ('CBSUA answer', 40)]
for j, (h, w) in enumerate(hdr, 1):
    c = ws.cell(1, j, h); c.font = HEAD; c.fill = HEAD_FILL; c.alignment = CENTER; c.border = BORDER
    ws.column_dimensions[get_column_letter(j)].width = w
i = 2
for area, md in (('HRIS', 'hris.md'), ('FMIS', 'fmis.md'), ('LMS / UIS', 'academic-lms.md')):
    sec = section(md, 'Questions for CBSUA')
    for line in sec.splitlines():
        line = line.strip()
        m = re.match(r'^(?:[-*]|\d+\.)\s+(.*)$', line)
        if not m:
            if line.startswith('|') and not line.startswith('|---') and not re.match(r'^\|\s*(#|Question|Area|ID)\b', line):
                cells = [clean(c) for c in line.strip('|').split('|')]
                txt = ' — '.join(c for c in cells if c)
            else:
                continue
        else:
            txt = clean(m.group(1))
        if not txt: continue
        for j, v in enumerate([area, txt, ''], 1):
            c = ws.cell(i, j, v); c.alignment = WRAP; c.border = BORDER
        i += 1
ws.freeze_panes = 'A2'

ws = wb.create_sheet('How to use the updates')
for j, (h, w) in enumerate([('Tab', 11), ('Item ID', 10), ('Original request', 50), ('ATLAS now', 12), ('How to use it, step by step', 110)], 1):
    c = ws.cell(1, j, h); c.font = HEAD; c.fill = HEAD_FILL; c.alignment = CENTER; c.border = BORDER
    ws.column_dimensions[get_column_letter(j)].width = w
r = 2
for x in records:
    if not x['howto']: continue
    for j, v in enumerate([x['tab'], x['id'], x['desc'], x['status'], x['howto']], 1):
        c = ws.cell(r, j, v); c.alignment = WRAP; c.border = BORDER
    ws.cell(r, 4).fill = PatternFill('solid', fgColor=STATUS_FILL.get(x['status'], 'FFFFFF'))
    r += 1
ws.freeze_panes = 'C2'
ws = wb.create_sheet('Change log')
for j, (h, w) in enumerate([('Date', 12), ('Items', 26), ('What changed for end users', 110)], 1):
    c = ws.cell(1, j, h); c.font = HEAD; c.fill = HEAD_FILL; c.alignment = CENTER; c.border = BORDER
    ws.column_dimensions[get_column_letter(j)].width = w
for i, row in enumerate(CHANGES, 2):
    for j, v in enumerate(row, 1):
        c = ws.cell(i, j, v); c.alignment = WRAP; c.border = BORDER
ws.freeze_panes = 'A2'
order = ['Summary', 'Change log', 'How to use the updates', 'All items', 'HRIS', 'FMIS', 'LMS', 'UIS', 'Cross-System', 'Declined & decisions', 'ATLAS issues found', 'Questions for CBSUA']
wb._sheets = [wb[n] for n in order]
wb.active = 0
for w in wb.worksheets:
    w.page_setup.orientation = 'landscape'
    w.page_setup.paperSize = w.PAPERSIZE_A4
    w.page_setup.fitToWidth = 1
    w.page_setup.fitToHeight = 0
    w.sheet_properties.pageSetUpPr.fitToPage = True
    w.print_title_rows = '1:1' if w.title != 'Summary' else None
wb.save(OUT)
from collections import Counter
print('records', len(records))
print(Counter((x['tab'], x['status']) for x in records))
print(Counter(x['plan'] for x in records))
print('questions rows', i - 2)
