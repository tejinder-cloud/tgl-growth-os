// The GST tax invoice as a one-page A4 PDF (plan Day 32b). Every figure comes from the stored invoice row.
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { amountInWords, money, SUPPLIER, type Tax } from "./invoice.js";

function font(file: string): string | null {
  for (const c of [path.join(__dirname, "../../assets/fonts", file), path.join(process.cwd(), "src/assets/fonts", file), path.join(process.cwd(), "dist/assets/fonts", file), path.join(process.cwd(), "services/tgl-ops/src/assets/fonts", file)])
    if (fs.existsSync(c)) return c;
  return null;
}

export type InvoiceDoc = {
  number: string; date: string; currency: string; taxableMinor: number; tax: Tax; sac: string; description: string; period: string | null;
  customer: { name: string; gstin: string | null; email: string | null }; paymentRef: string | null;
};

export async function invoicePdf(i: InvoiceDoc): Promise<Buffer> {
  const sans = font("dm-sans.ttf") ?? "Helvetica", serif = font("fraunces.ttf") ?? "Times-Bold";
  const doc = new PDFDocument({ size: "A4", margins: { top: 40, left: 40, right: 40, bottom: 40 }, info: { Title: `Tax invoice ${i.number}`, Author: SUPPLIER.trade } });
  const chunks: Buffer[] = []; doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => { doc.on("end", () => res(Buffer.concat(chunks))); doc.on("error", rej); });
  const X = 40, W = doc.page.width - 80, INK = "#2B2420", MUTED = "#6B625B";
  const total = i.taxableMinor + i.tax.lines.reduce((s, l) => s + l.minor, 0);

  doc.fillColor(INK).font(serif).fontSize(20).text("Tax Invoice", X, 40);
  doc.font(sans).fontSize(9).fillColor(MUTED).text("Original for recipient", X, 66);
  doc.font(sans).fontSize(10).fillColor(INK).text(`Invoice no. ${i.number}\nDate ${i.date}`, X + W - 200, 44, { width: 200, align: "right" });
  doc.moveTo(X, 90).lineTo(X + W, 90).strokeColor(INK).lineWidth(1).stroke();

  const col = (title: string, lines: string[], x: number, y: number, w: number) => {
    doc.font(sans).fontSize(8).fillColor(MUTED).text(title.toUpperCase(), x, y, { width: w, characterSpacing: 1 });
    doc.fontSize(10).fillColor(INK).text(lines.filter(Boolean).join("\n"), x, y + 14, { width: w });
  };
  col("Supplier", [SUPPLIER.trade, `Proprietor: ${SUPPLIER.proprietor}`, SUPPLIER.address, `GSTIN ${SUPPLIER.gstin} · State: Chandigarh (04)`, `${SUPPLIER.email} · ${SUPPLIER.phone}`], X, 104, W / 2 - 10);
  col("Billed to", [i.customer.name, i.customer.gstin ? `GSTIN ${i.customer.gstin}` : "Unregistered (no GSTIN)", i.customer.email ?? "", `Place of supply: ${i.tax.posName}${i.tax.posCode ? ` (${i.tax.posCode})` : ""}`], X + W / 2 + 10, 104, W / 2 - 10);

  let y = 210;
  const row = (cells: string[], bold = false, shade = false) => {
    const widths = [W * 0.46, W * 0.14, W * 0.14, W * 0.26];
    if (shade) doc.rect(X, y - 4, W, 20).fill("#F7F3EC");
    doc.font(sans).fontSize(10).fillColor(bold ? INK : INK);
    let x = X;
    cells.forEach((c, k) => { doc.text(c, x + 4, y, { width: widths[k] - 8, align: k === 3 ? "right" : "left" }); x += widths[k]; });
    y += Math.max(20, doc.heightOfString(cells[0], { width: widths[0] - 8 }) + 8);
  };
  row(["Description", "SAC", "Qty", "Amount"], true, true);
  row([`${i.description}${i.period ? `\n${i.period}` : ""}`, i.sac, "1", money(i.taxableMinor, i.currency)]);
  doc.moveTo(X, y).lineTo(X + W, y).strokeColor("#D8CFC2").stroke(); y += 8;
  row(["Taxable value", "", "", money(i.taxableMinor, i.currency)]);
  for (const l of i.tax.lines) row([`${l.label} @ ${l.rate}%`, "", "", money(l.minor, i.currency)]);
  doc.moveTo(X, y).lineTo(X + W, y).strokeColor(INK).stroke(); y += 8;
  row(["Total", "", "", money(total, i.currency)], true, true);
  y += 6;
  doc.font(sans).fontSize(9).fillColor(INK).text(`Amount in words: ${amountInWords(total, i.currency)}`, X, y, { width: W }); y = doc.y + 8;
  doc.fillColor(MUTED).text([
    "Tax payable on reverse charge: No.",
    i.tax.note ?? "",
    i.paymentRef ? `Paid online via Razorpay (payment ${i.paymentRef}).` : "",
  ].filter(Boolean).join("\n"), X, y, { width: W });
  doc.fillColor(INK).text(`For ${SUPPLIER.trade}\n\nAuthorised signatory\n(Computer-generated invoice; no signature required.)`, X + W - 220, doc.y + 30, { width: 220, align: "right" });
  doc.end();
  return done;
}
