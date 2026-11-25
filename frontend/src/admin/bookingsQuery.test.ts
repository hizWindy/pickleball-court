import { describe, expect, it } from 'vitest';
import { ALL, isFiltered, listQuery, loadPages, PAGE, pickFilter, type ListFilters } from './bookingsQuery';
import type { AdminBooking, AdminBookingList, ListQuery } from './types';

const TODAY = '2026-10-10';

describe('the Bookings list query', () => {
  it('opens on everything: no dates, both courts, still-to-play first', () => {
    expect(listQuery(ALL, TODAY)).toEqual({
      q: undefined, status: undefined, label: undefined, courtId: undefined, sort: 'upcoming_first', dateFrom: undefined, dateTo: undefined,
    });
    expect(isFiltered(ALL)).toBe(false);
  });

  it('tapping All clears the search, the court and the dates', () => {
    const narrowed: ListFilters = { filter: 'paid', range: 'past', courtId: 'court-2', q: 'maria' };
    expect(pickFilter(narrowed, 'all')).toEqual(ALL);
    expect(listQuery(pickFilter(narrowed, 'all'), TODAY)).toEqual(listQuery(ALL, TODAY));
  });

  it('other chips keep the dates, court and search the host picked', () => {
    const picked = pickFilter({ ...ALL, range: 'upcoming', courtId: 'court-1' }, 'late');
    expect(picked).toEqual({ filter: 'late', range: 'upcoming', courtId: 'court-1', q: '' });
    expect(listQuery(picked, TODAY)).toMatchObject({ label: 'late', courtId: 'court-1', dateFrom: TODAY, dateTo: undefined, sort: 'start_desc' });
  });

  it('asks for labels and statuses the way the server expects', () => {
    expect(listQuery({ ...ALL, filter: 'blocked' }, TODAY)).toMatchObject({ label: 'blocked', status: undefined });
    expect(listQuery({ ...ALL, filter: 'paid_late' }, TODAY)).toMatchObject({ label: 'paid_late', status: undefined });
    expect(listQuery({ ...ALL, filter: 'expired' }, TODAY)).toMatchObject({ status: 'expired', label: undefined });
    expect(listQuery({ ...ALL, filter: 'paid' }, TODAY)).toMatchObject({ label: 'paid', sort: 'start_asc' });
  });

  it('uses the date box, except while searching', () => {
    expect(listQuery({ ...ALL, range: 'upcoming' }, TODAY)).toMatchObject({ dateFrom: TODAY, dateTo: undefined, sort: 'start_asc' });
    expect(listQuery({ ...ALL, range: 'past' }, TODAY)).toMatchObject({ dateFrom: undefined, dateTo: '2026-10-09', sort: 'start_desc' });
    expect(listQuery({ ...ALL, range: 'past', q: 'HPC-AB' }, TODAY)).toMatchObject({ dateFrom: undefined, dateTo: undefined, sort: 'created_desc' });
  });
});

describe('Show more', () => {
  const booking = (n: number) => ({ code: `HPC-${String(n).padStart(8, '0')}` }) as AdminBooking;
  /** A fake server with `total` bookings that caps a page at 200, like the real one. */
  function server(total: number) {
    const calls: ListQuery[] = [];
    const list = async (q: ListQuery): Promise<AdminBookingList> => {
      calls.push(q);
      const size = Math.min(q.pageSize ?? 25, 200);
      const start = ((q.page ?? 1) - 1) * size;
      const items = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => booking(start + i));
      return { items, total, page: q.page ?? 1, pageSize: size, counts: {} as AdminBookingList['counts'] };
    };
    return { list, calls };
  }

  it('grows 25 at a time, past 200, with every booking once and in order', async () => {
    const { list } = server(260);
    for (const pages of [1, 2, 8, 9, 11]) {
      const got = await loadPages({ sort: 'upcoming_first' }, pages, list);
      const want = Math.min(pages * PAGE, 260);
      expect(got.items.map((b) => b.code)).toEqual(Array.from({ length: want }, (_, i) => booking(i).code));
      expect(got.total).toBe(260);
    }
  });

  it('asks in as few requests as the server allows', async () => {
    const { list, calls } = server(1000);
    await loadPages({}, 3, list);
    expect(calls).toEqual([{ page: 1, pageSize: 75 }]);
    calls.length = 0;
    await loadPages({}, 9, list); // 225 rows: two requests of 200
    expect(calls).toEqual([
      { page: 1, pageSize: 200 },
      { page: 2, pageSize: 200 },
    ]);
  });

  it('never shows a booking twice when it moved between two requests', async () => {
    const list = async (q: ListQuery): Promise<AdminBookingList> => {
      // The second request starts with the last booking of the first one again.
      const start = q.page === 1 ? 0 : 199;
      const items = Array.from({ length: 200 }, (_, i) => booking(start + i));
      return { items, total: 400, page: q.page ?? 1, pageSize: 200, counts: {} as AdminBookingList['counts'] };
    };
    const got = await loadPages({}, 10, list);
    const codes = got.items.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(250);
  });
});
