/** Same rules as the server (backend/app/validation.py), so mistakes show before tapping Continue. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+63')) d = '0' + d.slice(3);
  else if (d.startsWith('63') && d.length === 12) d = '0' + d.slice(2);
  return /^09\d{9}$/.test(d) ? d : null;
}
