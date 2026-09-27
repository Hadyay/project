/** تفقيط — the amount written out in Arabic words.
 *
 *  Every receipt the office has ever issued carries one: the legacy RECEIPT
 *  table kept it in a COMMENT column ("ثمانون ألف  دولار"), handwritten by the
 *  clerk. A voucher without it is not a voucher here, so the printable receipt
 *  generates it.
 *
 *  Scope is deliberate: non-negative amounts below a trillion, two decimal
 *  places, with the fraction written as a figure (٥٠/١٠٠ in Western digits)
 *  rather than in words — "سنتاً" is wrong for ليرة, and every currency in
 *  this ledger divides by a hundred. */

const ONES = [
  "",
  "واحد",
  "اثنان",
  "ثلاثة",
  "أربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "ثمانية",
  "تسعة",
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
];

const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];

const HUNDREDS = [
  "",
  "مئة",
  "مئتان",
  "ثلاثمئة",
  "أربعمئة",
  "خمسمئة",
  "ستمئة",
  "سبعمئة",
  "ثمانمئة",
  "تسعمئة",
];

/** Group words take one of four shapes depending on how many of them there
 *  are: singular, dual, plural (3–10), then singular again with tanwīn. */
interface GroupForms {
  one: string;
  two: string;
  few: string;
  many: string;
}

const GROUPS: GroupForms[] = [
  { one: "", two: "", few: "", many: "" },
  { one: "ألف", two: "ألفان", few: "آلاف", many: "ألفاً" },
  { one: "مليون", two: "مليونان", few: "ملايين", many: "مليوناً" },
  { one: "مليار", two: "ملياران", few: "مليارات", many: "ملياراً" },
];

/** 1–999 in words. */
function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  if (hundreds) parts.push(HUNDREDS[hundreds]);

  if (rest) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const unit = rest % 10;
      // Arabic reads the unit first: واحد وعشرون, not عشرون وواحد.
      parts.push(unit ? `${ONES[unit]} و${TENS[Math.floor(rest / 10)]}` : TENS[Math.floor(rest / 10)]);
    }
  }

  return parts.join(" و");
}

function groupWords(n: number, group: number): string {
  if (n === 0) return "";
  if (group === 0) return underThousand(n);

  const forms = GROUPS[group];
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;

  // Which form the group word takes is decided by the last two digits, not by
  // the whole number: ٢٣٤ ألفاً but ٢٠٠ ألف and ١٠٥ آلاف.
  const tail = n % 100;
  if (tail === 0) {
    // …مئتا ألف, not مئتان ألف — the hundred is in construct with what follows.
    return `${underThousand(n).replace(/مئتان$/, "مئتا")} ${forms.one}`;
  }
  if (tail >= 3 && tail <= 10) return `${underThousand(n)} ${forms.few}`;
  return `${underThousand(n)} ${forms.many}`;
}

/** A non-negative integer in Arabic words. */
export function numberToArabic(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "صفر";

  const chunks: string[] = [];
  for (let group = 0; n > 0 && group < GROUPS.length; group += 1) {
    const part = n % 1000;
    n = Math.floor(n / 1000);
    if (part) chunks.unshift(groupWords(part, group));
  }

  if (n > 0) return String(Math.floor(Math.abs(value))); // beyond مليار — print the figure
  return chunks.join(" و");
}

/** The full line a voucher prints: «فقط ثمانون ألفاً دولار لا غير». */
export function tafqeet(amount: string | number, currency?: string | null): string {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return "—";

  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const fraction = Math.round((absolute - whole) * 100);

  const words = numberToArabic(whole);
  const parts = [words];
  if (currency) parts.push(currency);
  if (fraction) parts.push(`و ${fraction}/100`);

  return `${negative ? "سالب " : ""}فقط ${parts.join(" ")} لا غير`;
}
