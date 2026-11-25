"""The desk's Bookings list: what "All" shows, how the chips add up, paging, and the 5 AM play day in the usage figures.

The fake clock starts on Sat Oct 10 2026, 10:00 AM Manila.
"""

from datetime import datetime

from app.clock import MANILA, UTC

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
TODAY, YESTERDAY = "2026-10-10", "2026-10-09"
DATE_CHOICES = ({}, {"dateFrom": TODAY}, {"dateTo": YESTERDAY})  # All dates, Today & later, Earlier dates
# The chips under "All" (Expired is one of them, but "All" leaves expired holds out).
CHIPS = {"paid": "paid", "late": "late", "done": "done", "rain_delay": "rainDelay", "blocked": "blocked"}
STATUS_CHIPS = ("held", "rejected", "cancelled")


def at(fake_now, day, hour, minute=0):
    fake_now.current = datetime(2026, 10, day, hour, minute, tzinfo=MANILA).astimezone(UTC)


def add(admin, date, hour, hours=1, kind="walk_in", name=None, court="court-1"):
    res = admin.post("/api/admin/bookings", json={
        "kind": kind, "courtId": court, "date": date, "hour": hour, "hours": hours,
        "customerName": name or f"{kind} {date} {hour}", "customerPhone": "", "paymentMethod": "cash",
    })
    assert res.status_code == 201, res.text
    return res.json()["code"]


def hold(client, booking_payload, **kw):
    res = client.post("/api/bookings", json=booking_payload(**kw))
    assert res.status_code == 201, res.text
    body = res.json()
    return body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}


def paid(client, booking_payload, **kw):
    code, headers = hold(client, booking_payload, **kw)
    res = client.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", PNG + code.encode())})
    assert res.status_code == 200, res.text
    return code


def listing(admin, **params):
    res = admin.get("/api/admin/bookings", params={"pageSize": 200, **params})
    assert res.status_code == 200, res.text
    return res.json()


def every_state(admin, booking_payload, fake_now):
    """One booking in each state the desk can show, spread over yesterday, today and tomorrow."""
    at(fake_now, 10, 9)
    expired, _ = hold(admin, booking_payload, hour=18, customerName="Never paid", customerPhone="09181110000")
    late = add(admin, TODAY, 10, name="Phone group")  # booked ahead, nobody taps Arrived
    at(fake_now, 10, 10, 16)  # the hold ran out, and the 10 AM group is Late
    codes = {
        "expired": expired,
        "late": late,
        "done": add(admin, TODAY, 9, name="Morning walk-in"),  # 9-10 AM, already over
        "paid": add(admin, "2026-10-11", 9, name="Tomorrow"),
        "blocked": add(admin, "2026-10-11", 20, kind="block", name="Court repair"),
        "held": hold(admin, booking_payload, hour=21, customerName="Paying now", customerPhone="09181110001")[0],
        "rain_delay": paid(admin, booking_payload, hour=15, customerName="Rained out", customerPhone="09181110002"),
        "rejected": paid(admin, booking_payload, hour=17, customerName="Fake receipt", customerPhone="09181110003"),
        "cancelled": add(admin, YESTERDAY, 19, name="Voided"),
        "earlier": add(admin, YESTERDAY, 9, name="Yesterday's game"),
    }
    assert admin.post("/api/admin/rain-delay", json={"date": TODAY, "fromHour": 15, "hours": 1}).status_code == 200
    assert admin.post(f"/api/admin/bookings/{codes['rejected']}/reject", json={}).status_code == 200
    assert admin.post(f"/api/admin/bookings/{codes['cancelled']}/cancel", json={}).status_code == 200
    return codes


# ── "All" ─────────────────────────────────────────────────────────────────────
def test_all_lists_every_date_upcoming_first_then_the_latest_past(admin, booking_payload, fake_now):
    past = [add(admin, d, 19, name=f"Played {d}") for d in ("2026-10-03", "2026-10-08", YESTERDAY)]
    ended = add(admin, TODAY, 9, name="Ended at 10")  # 9-10 AM: over exactly now
    under_way = add(admin, TODAY, 10, name="Under way")  # 10-11 AM
    tonight = paid(admin, booking_payload, hour=19, customerName="Tonight")
    block = add(admin, "2026-10-11", 20, kind="block", name="Court repair")
    monday = add(admin, "2026-10-12", 19, name="Monday")

    res = listing(admin, sort="upcoming_first")  # what the desk asks for when it opens on "All"
    assert [b["code"] for b in res["items"]] == [under_way, tonight, block, monday, ended, *reversed(past)]
    assert res["total"] == res["counts"]["all"] == 8


def test_all_leaves_out_holds_that_ran_out_but_a_search_finds_them(admin, booking_payload, fake_now):
    gone, _ = hold(admin, booking_payload, hour=18, customerName="Never paid")
    fake_now.advance(minutes=11)
    kept = add(admin, TODAY, 19, name="Walk-in")

    everything = listing(admin, sort="upcoming_first")
    assert [b["code"] for b in everything["items"]] == [kept]
    assert everything["counts"]["all"] == 1 and everything["counts"]["expired"] == 1
    assert [b["code"] for b in listing(admin, status="expired")["items"]] == [gone]
    # Looking for it by name or code still finds it, and the count agrees with the list.
    for term in ("never paid", gone):
        found = listing(admin, q=term)
        assert [b["code"] for b in found["items"]] == [gone] and found["counts"]["all"] == found["total"] == 1


def test_all_can_show_expired_holds_again_with_a_setting(admin, booking_payload, fake_now, monkeypatch):
    from dataclasses import replace

    from app import admin_service

    monkeypatch.setattr(admin_service, "settings", replace(admin_service.settings, all_includes_expired=True))
    hold(admin, booking_payload, hour=18)
    fake_now.advance(minutes=11)
    res = listing(admin)
    assert res["total"] == res["counts"]["all"] == 1 and res["items"][0]["label"] == "expired"


# ── The chips ─────────────────────────────────────────────────────────────────
def test_the_chips_add_up_to_all_and_each_lists_its_own_number(admin, booking_payload, fake_now):
    codes = every_state(admin, booking_payload, fake_now)
    seen = {}
    for dates in DATE_CHOICES:
        everything = listing(admin, **dates)
        counts = everything["counts"]
        chips = {k: counts[v] for k, v in CHIPS.items()} | {k: counts[k] for k in STATUS_CHIPS}
        # Every booking falls under exactly one chip (expired holds have their own, outside "All").
        assert sum(chips.values()) + counts["pendingVerification"] == counts["all"] == everything["total"], dates
        assert sorted(b["label"] for b in everything["items"]) == sorted(
            label if label in CHIPS else {"held": "awaiting"}.get(label, label) for label, n in chips.items() for _ in range(n)
        ), dates
        for label in CHIPS:
            assert listing(admin, label=label, **dates)["total"] == chips[label], (dates, label)
        for status in (*STATUS_CHIPS, "expired"):
            assert listing(admin, status=status, **dates)["total"] == counts[status], (dates, status)
        seen[str(dates)] = chips

    # The three date choices split the same bookings: today & later plus earlier dates is all of them.
    total = {k: seen[str({"dateFrom": TODAY})][k] + seen[str({"dateTo": YESTERDAY})][k] for k in seen[str({})]}
    assert total == seen[str({})]
    assert seen[str({})] == {"paid": 1, "late": 1, "done": 2, "rain_delay": 1, "blocked": 1, "held": 1, "rejected": 1, "cancelled": 1}
    assert [b["code"] for b in listing(admin, label="blocked")["items"]] == [codes["blocked"]]


def test_unknown_label_is_refused(admin):
    res = admin.get("/api/admin/bookings", params={"label": "bogus"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "bad_label"


# ── Paging ────────────────────────────────────────────────────────────────────
def test_pages_follow_on_without_repeating_or_skipping_a_booking(admin, fake_now):
    for day in range(4, 17):  # Oct 4 - Oct 16: past and future
        for hour in (7, 9, 11, 13, 19):
            add(admin, f"2026-10-{day:02d}", hour, name=f"Game {day}-{hour}")
    for sort in ("upcoming_first", "start_desc", "start_asc", "created_desc"):
        one_go = listing(admin, sort=sort, pageSize=75)
        pages = [admin.get("/api/admin/bookings", params={"sort": sort, "pageSize": 25, "page": p}).json() for p in (1, 2, 3)]
        codes = [b["code"] for page in pages for b in page["items"]]
        assert codes == [b["code"] for b in one_go["items"]], sort
        assert len(codes) == len(set(codes)) == 65 and all(page["total"] == 65 for page in pages), sort
    # The server never sends more than 200 at once; the desk asks for the next page instead.
    assert admin.get("/api/admin/bookings", params={"pageSize": 500}).json()["pageSize"] == 200


# ── Usage ─────────────────────────────────────────────────────────────────────
def test_usage_counts_court_hours_from_5_am(admin, fake_now):
    # Sat 10:00 AM: the play day opened at 5 AM, so 5 hours have been on offer on each of the two courts.
    o = admin.get("/api/admin/overview", params={"days": 1}).json()
    assert o["kpis"]["courtHoursAvailable"] == 10
    add(admin, TODAY, 5, name="Early bird")  # 5-6 AM
    assert admin.get("/api/admin/overview", params={"days": 1}).json()["kpis"]["utilisationPct"] == 10.0
