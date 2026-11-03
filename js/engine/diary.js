// v0.80.0 (owner, 3 Nov): the daily report as the site diary, signed by the project's consultant by link, the way a
// site instruction is (company/main/silinks with kind 'diary', answered once in company/main/sisigned). Only on projects
// whose consultant switch is on (Documents > Consultant). Sent by the Admin, a PM or the GM, one day at a time.

export const DIARY_MAX = 900_000;   // the consultant's copy is one database record (at most 1 MB)
export const DIARY_DAYS = 2;        // sent and not signed for this many days: a reminder

export const DIARY_STATUS = { sent: 'Waiting for the consultant', signed: 'Signed by the consultant', commented: 'Commented by the consultant' };
export const DIARY_TONE = { sent: 'warn', signed: 'ok', commented: 'warn' };

export const consultantOf = p => ({ on: !!p?.consultant?.on, name: p?.consultant?.name || '', contact: p?.consultant?.contact || '' });

export const maySendDiary = (role, ranks) => role === 'owner' || (ranks || []).some(r => r === 'project_manager' || r === 'general_manager');

/** The copy the consultant reads: the day's report as a page, nothing else of the project. */
export const diaryLink = (r, project, link, by, page) => ({
  id: link, kind: 'diary', pid: project.id, rid: r.id, project: project.name || '', no: r.field?.no ? `No. ${r.field.no}` : '',
  date: r.date, from: consultantOf(project).name, subject: `Daily site report, ${r.date}`, html: page, status: 'sent', by, at: new Date().toISOString(),
});

/** The page within the size of one record: the photos are left out when it is too big. */
export function diaryPage(page) {
  if (page.length <= DIARY_MAX) return page;
  const lean = page.replace(/<img[^>]*src="data:[^"]*"[^>]*>/g, '');
  return lean.length <= DIARY_MAX ? lean.replace('</body>', '<p style="font:12px sans-serif;color:#666">The photos are left out of this copy because of their size.</p></body>') : '';
}

const day = iso => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);

/** Reports sent to the consultant and not answered for DIARY_DAYS days or more. */
export const diaryWaiting = (reports, today) =>
  (reports || []).filter(r => r.diary?.status === 'sent' && r.diary.sentAt && (day(today) - day(r.diary.sentAt)) / 864e5 >= DIARY_DAYS);

/** Where the link goes: WhatsApp for a phone number, an email for an address, else '' (the link is copied). */
export function contactUrl(contact, text) {
  const c = String(contact || '').trim();
  const mail = c.match(/[^\s,;<>]+@[^\s,;<>]+\.[a-z]{2,}/i);
  if (mail) return `mailto:${mail[0]}?subject=${encodeURIComponent('Daily site report to sign')}&body=${encodeURIComponent(text)}`;
  const digits = c.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^0(?=9\d{8}$)/, '251');
  return digits.length >= 9 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : '';
}
