// services/tgl-ops/src/agents/pipeline/outreach-page.ts
// /pipeline/outreach (25 Nov 2026): every business outreach is handling, by where it stands. Sent, next in line for
// an email, phone-only and waiting for WhatsApp (with its advance AI check), and paused. No cold calls.
import { dayOnly, timeOnly, type LiveView } from "./live-view.js";
import { esc, renderShell } from "./shell.js";

export const OUTREACH_CSS = `.jump{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 16px;padding:0;list-style:none}
.jump a{display:flex;align-items:center;gap:8px;text-decoration:none;background:var(--white);border:2px solid var(--ink);border-radius:999px;padding:6px 14px;font-weight:600;font-size:.9rem;box-shadow:2px 2px 0 var(--grey)}
.jump a:hover{transform:translate(-1px,-1px)}.jump .count{font-size:.72rem}
section.panel{scroll-margin-top:14px}
.grp th{text-align:left;font-size:.78rem;color:var(--terra-text);font-weight:600;padding:12px 0 4px;border:0}
.when{white-space:nowrap;color:var(--ink-2)}
.fit{font-size:.74rem;font-weight:600;border:1.5px solid var(--grey);border-radius:999px;padding:1px 8px;color:var(--mute);white-space:nowrap}
.chk{display:block;font-size:.86rem;color:var(--ink-2);margin-top:3px}.chk.wait{color:var(--mute);font-style:italic}
.msg{margin-top:6px}.msg summary{font-size:.8rem;color:var(--sage-dk);margin:0}.msg p{margin-top:6px;padding:10px 12px;background:#E3EEDC;border-radius:10px 10px 10px 2px;font-size:.86rem;line-height:1.45;color:var(--ink)}
.probs{list-style:none;margin:0;padding:0}.probs li{border-left:3px solid var(--terra);padding:4px 0 4px 12px;margin:8px 0}
@media (prefers-reduced-motion:reduce){.jump a:hover{transform:none}}`;

const SHOW = 12;

function queueItem(c: { company: string; city: string; type: string; fit: number }, extra = ""): string {
  return `<li><div><b>${esc(c.company)}</b><span class="sub">${esc([c.type, c.city].filter(Boolean).join(", "))}</span>${extra}</div><span class="fit" title="Fit score">fit ${c.fit}</span></li>`;
}

function capped<T>(rows: T[], item: (r: T) => string, id: string): string {
  const head = rows.slice(0, SHOW).map(item).join("");
  const rest = rows.slice(SHOW);
  return `<ul class="list">${head}</ul>${rest.length ? `<details id="${id}-more"><summary>Show ${rest.length} more</summary><ul class="list">${rest.map(item).join("")}</ul></details>` : ""}`;
}

export function renderOutreachMain(v: LiveView): string {
  const sentToday = v.outbox.filter((r) => r.today);
  const earlier = v.outbox.filter((r) => !r.today);
  const pausedCount = v.paused.reduce((n, g) => n + g.names.length, 0);

  const jump = `<ul class="jump">
<li><a href="#sent">Sent today <span class="count">${sentToday.length}</span></a></li>
<li><a href="#next">Next in line <span class="count">${v.nextInLine.length}</span></a></li>
<li><a href="#whatsapp">Waiting for WhatsApp <span class="count">${v.calls.length}</span></a></li>
<li><a href="#paused">Paused <span class="count">${pausedCount}</span></a></li>
</ul>`;

  const row = (r: (typeof v.outbox)[number]) => `<tr><td><b>${esc(r.company)}</b>${r.city ? `<span class="sub">${esc(r.city)}</span>` : ""}</td><td>${esc(r.what)}</td><td class="when">${esc(r.today ? timeOnly(r.sentAt) : dayOnly(r.sentAt))}</td></tr>`;
  const sent = `<section class="panel" id="sent"><h2>Sent <span class="count">${v.today.sent} of ${v.today.cap} today</span></h2>${
    v.outbox.length
      ? `<table><thead><tr><th>Business</th><th>Message</th><th>When</th></tr></thead><tbody>${sentToday.length ? `<tr class="grp"><th colspan="3">Today</th></tr>${sentToday.map(row).join("")}` : `<tr class="grp"><th colspan="3">Nothing sent yet today</th></tr>`}${earlier.length ? `<tr class="grp"><th colspan="3">Earlier</th></tr>${earlier.slice(0, 8).map(row).join("")}` : ""}</tbody></table>${earlier.length > 8 ? `<details id="sent-more"><summary>Show ${earlier.length - 8} earlier</summary><table><tbody>${earlier.slice(8).map(row).join("")}</tbody></table></details>` : ""}<p class="foot">The full text of every email is in #revenue.</p>`
      : `<p class="ok">Nothing has been sent yet.</p>`
  }</section>`;

  const days = v.today.cap > 0 ? Math.ceil(v.nextInLine.length / v.today.cap) : 0;
  const next = `<section class="panel" id="next"><h2>Next in line <span class="count">${v.nextInLine.length}</span></h2><p class="lead">Approved, with an email address, not contacted yet. Highest fit goes first.${v.nextInLine.length && v.today.cap ? ` At ${v.today.cap} a day, that is ${days} sending ${days === 1 ? "day" : "days"}.` : ""}</p>${
    v.nextInLine.length ? capped(v.nextInLine, (c) => queueItem(c), "next") : `<p class="ok">No approved business with an email is waiting.</p>`
  }</section>`;

  const waItem = (c: (typeof v.calls)[number]) =>
    queueItem(
      c,
      `${c.check ? `<span class="chk">${esc(c.check)}</span>` : ""}${
        c.message ? `<details class="msg"><summary>WhatsApp message ready</summary><p>${esc(c.message)}</p></details>` : `<span class="chk wait">${esc(c.skip || "AI check not run yet")}</span>`
      }`
    );
  const wa = `<section class="panel" id="whatsapp"><h2>Waiting for WhatsApp <span class="count">${v.calls.length}</span></h2><p class="lead">Approved, no email address, a phone number. Their first message is a WhatsApp note, sent once Meta approves the app and the message template. <b>${v.whatsappReady}</b> ${v.whatsappReady === 1 ? "message is" : "messages are"} ready; open one to read it exactly as the business would. Nothing is sent yet.</p>${
    v.calls.length ? capped(v.calls, waItem, "wa") : `<p class="ok">No approved business is waiting for WhatsApp.</p>`
  }</section>`;

  const paused = `<section class="panel" id="paused"><h2>Paused <span class="count">${pausedCount}</span></h2>${
    v.paused.length ? `<ul class="probs">${v.paused.map((p) => `<li>${esc(p.text)}<span class="sub">${esc(p.names.join(", "))}</span></li>`).join("")}</ul>` : `<p class="ok">Nothing is paused.</p>`
  }</section>`;

  return `${jump}<div class="row">${sent}</div><div class="row two">${next}${wa}</div><div class="row">${paused}</div>
<p class="foot">Updated ${esc(timeOnly(v.generatedAt))} IST. Refreshes every minute while open.</p>`;
}

export function renderOutreachPage(v: LiveView, email: string): string {
  return renderShell({
    title: "Outreach",
    tab: "outreach",
    email,
    heading: `Outreach, <span class="acc">business by business.</span>`,
    subline: "Who has been contacted, who is next, and who is waiting.",
    main: renderOutreachMain(v),
    css: OUTREACH_CSS,
    partUrl: "/pipeline/outreach?part=main",
  });
}
