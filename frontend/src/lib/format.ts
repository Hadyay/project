import type {
  ApartmentStatus,
  ContractStatus,
  ContractType,
  EntryType,
  PaymentMethod,
  ScheduleStatus,
} from "./types";

/** Money is grouped with Western digits and always LTR — an accountant reads
 *  figures the same way in any language, and tabular-nums needs a stable glyph
 *  width. Arabic labels around them still read RTL. */
export function money(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Whole numbers (counts, unit tallies) — no decimal tail. */
export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}

export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isNaN(n) ? 0 : n;
}

/** ISO dates stay ISO in the UI: the design shows them in mono, LTR, and they
 *  are unambiguous across the Hijri/Gregorian split the office works in. */
export function isoDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

export const UNIT_STATUS_AR: Record<ApartmentStatus, string> = {
  available: "متاحة",
  reserved: "محجوزة",
  sold: "مباعة",
  rented: "مؤجّرة",
  unavailable: "غير متاحة",
};

export const UNIT_TYPE_AR: Record<string, string> = {
  apartment: "شقة",
  shop: "محل",
  office: "مكتب",
  storage: "مستودع",
  land: "أرض",
  other: "أخرى",
};

export const CONTRACT_TYPE_AR: Record<ContractType, string> = {
  sale: "بيع",
  rent: "إيجار",
};

export const CONTRACT_STATUS_AR: Record<ContractStatus, string> = {
  draft: "مسودّة",
  active: "ساري",
  completed: "منتهٍ",
  cancelled: "ملغى",
  terminated: "مفسوخ",
};

export const SCHEDULE_STATUS_AR: Record<ScheduleStatus, string> = {
  pending: "مستحقّة",
  partial: "جزئية",
  paid: "مدفوعة",
  overdue: "متأخرة",
  cancelled: "ملغاة",
};

export const ENTRY_TYPE_AR: Record<EntryType, string> = {
  opening: "افتتاحي",
  sale: "مبيع",
  rent_invoice: "فاتورة إيجار",
  receipt: "قبض",
  payment: "صرف",
  adjustment: "تسوية",
  transfer: "تحويل",
};

export const METHOD_AR: Record<PaymentMethod, string> = {
  cash: "نقداً",
  bank_transfer: "حوالة مصرفية",
  cheque: "شيك",
  card: "بطاقة",
  other: "أخرى",
};

export const ACCOUNT_TYPE_AR: Record<string, string> = {
  asset: "أصول",
  liability: "خصوم",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصاريف",
};

/** Pill colour for a unit status, matching the design's .pill variants. */
export function unitPill(status: ApartmentStatus): string {
  switch (status) {
    case "sold":
      return "dark";
    case "rented":
      return "ok";
    case "reserved":
      return "wait";
    default:
      return "gray";
  }
}

export function contractPill(status: ContractStatus): string {
  switch (status) {
    case "active":
      return "ok";
    case "draft":
      return "wait";
    case "cancelled":
    case "terminated":
      return "late";
    default:
      return "gray";
  }
}

export function schedulePill(status: ScheduleStatus, daysLate = 0): string {
  if (status === "paid") return "ok";
  if (status === "cancelled") return "gray";
  if (daysLate > 30) return "late";
  if (daysLate > 0) return "wait";
  return "gray";
}

/** "متأخر ٦٩ يوم" reads better than a bare number in the late column. */
export function lateLabel(days: number): string {
  if (days <= 0) return "لم تستحق بعد";
  return `متأخر ${count(days)} يوم`;
}

export function initial(name: string | null | undefined): string {
  if (!name) return "؟";
  return name.trim().charAt(0);
}

/** "2026-09-17" -> "17/09/2026", the way the office's printed reports date things. */
export function dmy(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : value;
}

/** The day before an ISO date — "balance brought forward up to" on a statement. */
export function dayBefore(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
