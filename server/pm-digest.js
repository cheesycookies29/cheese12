// The Projects daily digest as an email: a subject, a plain-text body and a simple HTML version of
// the same (one column, inline styles only, no images or scripts). Everything from the data is
// escaped in the HTML. Links open CORE at `origin` when it is known; without it there are none.
import { DIGEST_MAX, HEALTH } from '../shared/projects.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (ymd) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// dg: shared/projects.js digestFor(); name: the person's; company: the company's name.
export function digestEmail(dg, { name = '', company = '', origin = null } = {}) {
  const link = (path) => (origin ? `${origin}/#${path}` : null);
  const taskLink = (t) => link(`/projects/${t.projectId}/tasks/${t.id}`);
  const parts = [
    { title: 'Overdue', items: dg.overdue.map((t) => ({ text: `${t.key} ${t.title}`, sub: `${t.projectName} · was due ${dateLabel(t.dueDate)}`, href: taskLink(t) })) },
    { title: 'Due in the next 3 working days', items: dg.dueSoon.map((t) => ({ text: `${t.key} ${t.title}`, sub: `${t.projectName} · due ${t.dueDate === dg.today ? 'today' : dateLabel(t.dueDate)}`, href: taskLink(t) })) },
    { title: 'Milestones at risk in projects you manage', items: dg.atRisk.map((m) => ({ text: `${m.name}${m.deliverable ? ' (deliverable)' : ''}`, sub: `${m.projectCode} ${m.projectName} · ${HEALTH[m.value]} · due ${dateLabel(m.dueDate)}${m.reason ? ` · ${m.reason}` : ''}`, href: link(`/projects/${m.projectId}`) })) },
  ].filter((p) => p.items.length);
  const counts = [dg.overdue.length && `${dg.overdue.length} overdue`, dg.dueSoon.length && `${dg.dueSoon.length} due soon`, dg.atRisk.length && plural(dg.atRisk.length, 'milestone') + ' at risk', dg.unread && `${dg.unread} unread`].filter(Boolean);
  const subject = `Your projects today: ${counts.join(', ') || 'nothing due'}`;
  const first = String(name).split(/\s+/)[0] || 'there';
  const myWork = link('/projects/my-work');
  const more = (p) => (p.items.length > DIGEST_MAX ? p.items.length - DIGEST_MAX : 0);
  const forYou = dg.unread ? `You have ${dg.unread} unread under For you on My work.` : '';
  const footer = `This is your daily digest from CORE Project Management${company ? ` (${company})` : ''}. Turn it off on My work: untick "Email me a daily digest".`;

  const text = [
    `Hello ${first},`,
    '',
    ...parts.flatMap((p) => [
      `${p.title.toUpperCase()} (${p.items.length})`,
      ...p.items.slice(0, DIGEST_MAX).map((i) => `- ${i.text}\n  ${i.sub}${i.href ? `\n  ${i.href}` : ''}`),
      ...(more(p) ? [`  and ${more(p)} more`] : []),
      '',
    ]),
    ...(forYou ? [forYou, ''] : []),
    ...(myWork ? [`My work: ${myWork}`, ''] : []),
    '--',
    footer,
  ].join('\n');

  const a = (href, body) => (href ? `<a href="${esc(href)}" style="color:#0b5cad">${body}</a>` : body);
  const html = `<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1f2933;background:#ffffff">
<div style="max-width:600px">
<p>Hello ${esc(first)},</p>
${parts.map((p) => `<h2 style="font-size:15px;margin:20px 0 6px">${esc(p.title)} (${p.items.length})</h2>
<ul style="padding-left:18px;margin:0">${p.items.slice(0, DIGEST_MAX).map((i) => `<li style="margin:0 0 6px">${a(i.href, `<strong>${esc(i.text)}</strong>`)}<br><span style="color:#52606d">${esc(i.sub)}</span></li>`).join('')}</ul>${more(p) ? `<p style="color:#52606d;margin:4px 0 0">and ${more(p)} more</p>` : ''}`).join('\n')}
${forYou ? `<p style="margin-top:20px">${esc(forYou)}</p>` : ''}
${myWork ? `<p>${a(myWork, 'Open My work')}</p>` : ''}
<p style="margin-top:24px;color:#52606d;font-size:12px">${esc(footer)}</p>
</div></body></html>`;
  return { subject, text, html };
}
