// GST tax invoices (plan Day 32b). Pure and tested: the tax split by place of supply, the invoice number and the
// amount in words. Falkan Media is registered in Chandigarh (state 04), a Union Territory — so supplies inside
// Chandigarh carry CGST + UTGST, supplies to other states IGST, exports zero-rated under LUT.

export const SUPPLIER = {
  trade: process.env.LEGAL_NAME?.trim() || "Falkan Media",
  proprietor: process.env.LEGAL_PROPRIETOR?.trim() || "Tejinder Singh",
  address: process.env.LEGAL_ADDRESS?.trim() || "709, PSB Complex, Sector 49-A, Chandigarh 160047",
  gstin: process.env.LEGAL_GSTIN?.trim() || "04BCLPS3803B1ZY",
  email: process.env.LEGAL_EMAIL?.trim() || "support@thegrowthlab.co.in",
  phone: process.env.LEGAL_PHONE?.trim() || "+91-9872009997",
};
export const supplierState = () => SUPPLIER.gstin.slice(0, 2);

/** Union Territories without a legislature levy UTGST instead of SGST. */
const UT = new Set(["04", "26", "31", "35", "38"]);
export const STATE_NAME: Record<string, string> = {
  "35": "Andaman and Nicobar Islands", "37": "Andhra Pradesh", "12": "Arunachal Pradesh", "18": "Assam", "10": "Bihar", "04": "Chandigarh", "22": "Chhattisgarh",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "07": "Delhi", "30": "Goa", "24": "Gujarat", "06": "Haryana", "02": "Himachal Pradesh", "01": "Jammu and Kashmir",
  "20": "Jharkhand", "29": "Karnataka", "32": "Kerala", "38": "Ladakh", "31": "Lakshadweep", "23": "Madhya Pradesh", "27": "Maharashtra", "14": "Manipur",
  "17": "Meghalaya", "15": "Mizoram", "13": "Nagaland", "21": "Odisha", "34": "Puducherry", "03": "Punjab", "08": "Rajasthan", "11": "Sikkim", "33": "Tamil Nadu",
  "36": "Telangana", "16": "Tripura", "09": "Uttar Pradesh", "05": "Uttarakhand", "19": "West Bengal",
};

export type TaxLine = { label: string; rate: number; minor: number };
export type Tax = { kind: "intra" | "inter" | "export"; posCode: string | null; posName: string; lines: TaxLine[]; note: string | null };

/** Place of supply: the customer's GSTIN state, else the state they chose; if neither is on record, the supplier's
 *  location (IGST Act s.12(2)(b)). Outside India: export of services. */
export function taxFor(o: { currency: string; gstMinor: number; gstRate: number; customerState: string | null; lutArn: string | null; supplier?: string }): Tax {
  const sup = o.supplier ?? supplierState();
  if (o.currency !== "INR") {
    return { kind: "export", posCode: null, posName: "Outside India (export of services)", lines: [{ label: "IGST", rate: 0, minor: 0 }],
      note: o.lutArn ? `Supply meant for export under LUT without payment of IGST (ARN ${o.lutArn}).` : "Export of services — LUT not on record: IGST to be paid by the supplier and refund claimed." };
  }
  const pos = o.customerState && STATE_NAME[o.customerState] ? o.customerState : sup;
  if (pos === sup) {
    const half = Math.floor(o.gstMinor / 2);
    return { kind: "intra", posCode: pos, posName: STATE_NAME[pos], note: null,
      lines: [{ label: "CGST", rate: o.gstRate / 2, minor: half }, { label: UT.has(pos) ? "UTGST" : "SGST", rate: o.gstRate / 2, minor: o.gstMinor - half }] };
  }
  return { kind: "inter", posCode: pos, posName: STATE_NAME[pos], note: null, lines: [{ label: "IGST", rate: o.gstRate, minor: o.gstMinor }] };
}

/** Indian financial year of a date (April–March), e.g. "2026-27". */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
export const invoiceNumber = (prefix: string, fy: string, seq: number) => `${prefix}/${fy}/${String(seq).padStart(4, "0")}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n: number): string { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`; }
function three(n: number): string { return n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " + two(n % 100) : ""}` : two(n); }
/** Indian numbering in words: 4718.82 INR → "Rupees Four Thousand Seven Hundred Eighteen and Paise Eighty Two Only". */
export function amountInWords(minor: number, currency: string): string {
  const whole = Math.floor(minor / 100), frac = minor % 100;
  const parts: string[] = [];
  let n = whole;
  for (const [div, name] of [[10_000_000, "Crore"], [100_000, "Lakh"], [1000, "Thousand"]] as const) {
    if (n >= div) { parts.push(`${three(Math.floor(n / div))} ${name}`); n %= div; }
  }
  if (n) parts.push(three(n));
  const unit = currency === "INR" ? ["Rupees", "Paise"] : ["US Dollars", "Cents"];
  return `${unit[0]} ${parts.join(" ") || "Zero"}${frac ? ` and ${unit[1]} ${two(frac)}` : ""} Only`;
}
export const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
