// services/tgl-ops/src/test-booking-routes.ts
// /book routes through the real Express app, with an injected booking service.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { setBookingServiceForTests } from "./agents/booking/live.js";
import { resetBookRateLimitForTests } from "./routes/book.js";

async function main() {
  const posted: any[] = [];
  setBookingServiceForTests({
    async slots() {
      return { open: true, days: [{ date: "2026-11-23", slots: ["2026-11-23T09:30:00.000Z"] }] };
    },
    async book(input: any) {
      posted.push(input);
      return input.email === "taken@x.example"
        ? { ok: false as const, status: 409, error: "slot_taken" as const, message: "That time was just taken. Please pick another.", days: [] }
        : { ok: true as const, start: input.start, end: input.start, meetUrl: "https://meet.google.com/x" };
    },
  } as any);
  const env = { ...process.env };
  delete process.env.GOOGLE_BOOKING_CLIENT_ID;

  const server = createApp("test-secret").listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const page = await fetch(`${base}/book`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Book a call with <span class="acc">Tejinder.<\/span>/);
    assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:/, "no outside scripts, styles or fonts");
    const logo = await fetch(`${base}/book/assets/logo.png`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${base}/book/assets/dm-sans-latin.woff2`)).status, 200);
    assert.equal((await fetch(`${base}/book/assets/..%2Fapp.ts`)).status, 404, "only the fixed list");
    assert.equal((await fetch(`${base}/book/assets/secret.env`)).status, 404);

    const slots: any = await (await fetch(`${base}/book/slots`)).json();
    assert.equal(slots.open, true);

    const ok = await fetch(`${base}/book`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: "2026-11-23T09:30:00.000Z", name: "A", email: "a@x.example", company: "B" }) });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as any).ok, true);
    assert.equal(posted[0].company, "B");

    const taken = await fetch(`${base}/book`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: "x", name: "A", email: "taken@x.example", company: "B" }) });
    assert.equal(taken.status, 409);

    // The rate limit stops a flood of booking attempts from one address.
    resetBookRateLimitForTests();
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await fetch(`${base}/book`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status;
    assert.equal(last, 429);

    // Connect refuses honestly while the Google settings are missing.
    const connect = await fetch(`${base}/book/connect`, { redirect: "manual" });
    assert.equal(connect.status, 503);

    // A callback without a valid signed state is refused.
    process.env.GOOGLE_BOOKING_CLIENT_ID = "cid";
    process.env.GOOGLE_BOOKING_CLIENT_SECRET = "sec";
    process.env.BOOKING_CALENDAR_EMAIL = "calls@x.example";
    process.env.BOOKING_PUBLIC_URL = "https://svc.example";
    const cb = await fetch(`${base}/book/oauth/callback?code=c&state=forged`);
    assert.equal(cb.status, 400);
    const go = await fetch(`${base}/book/connect`, { redirect: "manual" });
    assert.equal(go.status, 302);
    assert.match(go.headers.get("location") || "", /^https:\/\/accounts\.google\.com\//);
  } finally {
    server.close();
    process.env = env;
    setBookingServiceForTests(null, null);
  }
  console.log("test-booking-routes: all checks passed");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
