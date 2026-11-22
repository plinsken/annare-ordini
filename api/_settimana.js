// Order weeks: each is named by its Friday (YYYY-MM-DD) and closes that Friday at 16:00 Europe/Rome.
const TZ = 'Europe/Rome', ORA = 16;
const GIORNI = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtOff = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'longOffset' });
const iso = ms => new Date(ms).toISOString().slice(0, 10);

export function settimanaDi(ora) {
  const p = Object.fromEntries(fmt.formatToParts(ora).map(x => [x.type, x.value]));
  let giorni = (5 - GIORNI[p.weekday] + 7) % 7;
  if (giorni === 0 && Number(p.hour) >= ORA) giorni = 7;
  return iso(Date.UTC(+p.year, +p.month - 1, +p.day + giorni));
}

export function scadenza(settimana) {
  const [y, m, d] = settimana.split('-').map(Number);
  // DST changes on Sunday nights, so the offset at Friday noon holds at 16:00.
  const off = fmtOff.formatToParts(new Date(Date.UTC(y, m - 1, d, 12))).find(x => x.type === 'timeZoneName').value;
  const [, segno, hh, mm = '0'] = /GMT([+-])(\d\d):?(\d\d)?/.exec(off) || [, '+', '0'];
  const minuti = (segno === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
  return new Date(Date.UTC(y, m - 1, d, ORA) - minuti * 60000);
}

export const dataBreve = settimana => settimana.slice(8, 10) + '/' + settimana.slice(5, 7);
