// services/tgl-ops/src/test-booking.ts
// Booking page: slot rules, booking only after Google confirms, double booking, honeypot, outreach stop, sign-in state.
import assert from "node:assert/strict";
import { freeSlots, isOfferedSlot, istInstant, loadHolidays, workingDays } from "./agents/booking/slots.js";
import { createBookingService, type CalendarPort } from "./agents/booking/service.js";
import { createMemoryBookingStore } from "./agents/booking/store.js";
import { authUrl, emailFromIdToken, makeState, verifyState } from "./agents/booking/google.js";

async function main() {
  const holidays = new Set(["2026-11-24"]);
  // Saturday 21 Nov 2026, 13:00 IST
  const sat = new Date("2026-11-21T07:30:00Z");

  // Working days: Mon 23, (Tue 24 holiday), Wed 25 ...; never Sat/Sun.
  const wd = workingDays(sat, holidays, 4);
  assert.deepEqual(wd, ["2026-11-23", "2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.equal(workingDays(sat, holidays).length, 10);

  // Slots: 15:00, 15:30, 16:00, 16:30 IST.
  const mon = freeSlots(sat, [], holidays)[0];
  assert.equal(mon.date, "2026-11-23");
  assert.deepEqual(mon.slots, ["2026-11-23T09:30:00.000Z", "2026-11-23T10:00:00.000Z", "2026-11-23T10:30:00.000Z", "2026-11-23T11:00:00.000Z"]);

  // Three hours' notice: Monday 13:00 IST leaves 16:00 and 16:30 only.
  const monNoon = new Date("2026-11-23T07:30:00Z");
  assert.deepEqual(freeSlots(monNoon, [], holidays)[0].slots, ["2026-11-23T10:30:00.000Z", "2026-11-23T11:00:00.000Z"]);

  // Busy time hides overlapping slots: 15:10-15:40 IST blocks 15:00 and 15:30.
  const busy = [{ start: "2026-11-23T15:10:00+05:30", end: "2026-11-23T15:40:00+05:30" }];
  assert.deepEqual(freeSlots(sat, busy, holidays)[0].slots, ["2026-11-23T10:30:00.000Z", "2026-11-23T11:00:00.000Z"]);
  assert.equal(isOfferedSlot("2026-11-23T09:30:00.000Z", sat, busy, holidays), false);
  assert.equal(isOfferedSlot("2026-11-23T10:30:00.000Z", sat, busy, holidays), true);
  assert.equal(isOfferedSlot("2026-11-23T10:45:00.000Z", sat, [], holidays), false, "only listed starts");
  assert.equal(isOfferedSlot("2026-11-24T09:30:00.000Z", sat, [], holidays), false, "holiday");
  assert.equal(isOfferedSlot("2026-11-21T10:30:00.000Z", sat, [], holidays), false, "Saturday");
  assert.equal(istInstant("2026-11-23", 15 * 60).toISOString(), "2026-11-23T09:30:00.000Z");
  assert.ok(loadHolidays().has("2026-12-25"), "bundled holiday file loads");

  // --- booking ---
  const store = createMemoryBookingStore();
  const created: any[] = [];
  let failCreate = false;
  const calBusy: { start: string; end: string }[] = [];
  const present: string[] = [];
  const declined: string[] = [];
  const cal: CalendarPort = {
    async read() {
      return { busy: calBusy, present, declined };
    },
    async createEvent(ev) {
      if (failCreate) throw new Error("Google said no");
      created.push(ev);
      calBusy.push({ start: ev.start, end: ev.end });
      present.push(`ev${created.length}`);
      return { eventId: `ev${created.length}`, htmlLink: "", meetUrl: "https://meet.google.com/abc-defg-hij" };
    },
  };
  const notes: string[] = [];
  const stopped: string[] = [];
  let connected = true;
  const svc = createBookingService({
    now: () => sat,
    store,
    calendar: async () => (connected ? cal : null),
    holidays,
    hostName: "Tejinder Singh",
    notify: async (t) => {
      notes.push(t);
    },
    outreach: {
      async find(email) {
        return email === "neha@clinic.example" ? { id: "p1", company: "Luma", auditLine: "Their AI check: named in 2 of 30 answers." } : null;
      },
      async stop(id) {
        stopped.push(id);
      },
    },
  });

  const s = await svc.slots();
  assert.equal(s.open, true);
  assert.equal(s.days[0].slots.length, 4);

  const good = { start: "2026-11-23T09:30:00.000Z", name: "Neha", email: "Neha@Clinic.example", company: "Luma Fertility", note: "IVF" };
  const r1 = await svc.book(good);
  assert.equal(r1.ok, true);
  assert.equal(store.rows[0].status, "booked");
  assert.equal(store.rows[0].event_id, "ev1");
  assert.equal(created[0].guestEmail, "neha@clinic.example");
  assert.equal(created[0].end, "2026-11-23T09:50:00.000Z", "20 minutes");
  assert.deepEqual(stopped, ["p1"], "outreach stopped for a prospect in sequence");
  assert.match(notes[0], /^Call booked: Neha, Luma Fertility, Mon, 23 Nov, 3:00 pm IST\./);
  assert.match(notes[0], /Outreach emails to them have stopped/);

  // Same slot again: refused with fresh slots, no second event.
  const r2 = await svc.book({ ...good, email: "other@x.example" });
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.equal(r2.error, "slot_taken");
    assert.equal(r2.days![0].slots.includes(good.start), false);
  }
  assert.equal(created.length, 1);

  // Two at once for one slot: one wins.
  const both = await Promise.all([
    svc.book({ ...good, start: "2026-11-23T10:00:00.000Z", email: "a@x.example" }),
    svc.book({ ...good, start: "2026-11-23T10:00:00.000Z", email: "b@x.example" }),
  ]);
  assert.equal(both.filter((b) => b.ok).length, 1);

  // Google refuses: never "booked", slot released, #revenue told.
  failCreate = true;
  const r3 = await svc.book({ ...good, start: "2026-11-23T10:30:00.000Z", email: "c@x.example" });
  assert.equal(r3.ok, false);
  if (!r3.ok) assert.equal(r3.error, "calendar_failed");
  assert.equal(store.rows.at(-1)!.status, "cancelled");
  assert.match(notes.at(-1)!, /^Booking failed/);
  failCreate = false;

  // Validation and honeypot.
  const bad = await svc.book({ ...good, start: "2026-11-23T11:00:00.000Z", email: "nope" });
  assert.equal(bad.ok, false);
  const bot = await svc.book({ ...good, start: "2026-11-23T11:00:00.000Z", website: "http://spam" });
  assert.equal(bot.ok, false);
  assert.equal(await store.countBooked(), 2);

  // Guest declines ev1; ev2's event is removed by hand. Both bookings become cancelled and #revenue is told.
  assert.equal(await svc.sync(), 0, "nothing to cancel yet");
  declined.push("ev1");
  present.splice(present.indexOf("ev2"), 1);
  assert.equal(await svc.sync(), 2);
  assert.equal(await store.countBooked(), 0, "calls booked stays true");
  assert.ok(notes.some((n) => /^Booking cancelled: Neha, Luma Fertility, .*The guest declined/.test(n)));
  assert.ok(notes.some((n) => /The event was removed from the calendar/.test(n)));
  assert.equal(await svc.sync(), 0, "never cancelled twice");

  // Not connected: closed, honestly.
  connected = false;
  assert.deepEqual(await svc.slots(), { open: false, days: [] });
  const closed = await svc.book({ ...good, start: "2026-11-23T11:00:00.000Z" });
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.error, "not_open");

  // --- sign-in ---
  const st = makeState("secret", sat);
  assert.equal(verifyState(st, "secret", sat), true);
  assert.equal(verifyState(st, "other", sat), false);
  assert.equal(verifyState(st, "secret", new Date(sat.getTime() + 11 * 60000)), false, "expires after 10 minutes");
  // Change the last signature character to a different one (the old check failed whenever it already ended in "0").
  assert.equal(verifyState(st.replace(/.$/, st.endsWith("0") ? "1" : "0"), "secret", sat), false, "a changed signature is refused");
  const url = new URL(authUrl({ clientId: "cid", clientSecret: "s", calendarEmail: "calls@x.example", publicUrl: "https://svc.example" }, st));
  assert.equal(url.searchParams.get("redirect_uri"), "https://svc.example/book/oauth/callback");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("scope")!, /calendar\.events/);
  const tok = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
  assert.equal(emailFromIdToken(tok({ email: "Calls@X.example", email_verified: true })), "calls@x.example");
  assert.equal(emailFromIdToken(tok({ email: "calls@x.example", email_verified: false })), "");

  console.log("test-booking: all checks passed");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
