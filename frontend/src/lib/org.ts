/** Who the printed documents come from.
 *
 *  One place, because it appears on every voucher and report header. The
 *  legacy system kept this in CONFIGS.csv; when the client's real letterhead
 *  is settled, change it here (or lift it into the settings screen) rather
 *  than editing the voucher markup. */
export const ORG = {
  name: "إدارة العقارات",
  subtitle: "مجمّع الأبنية — بيروت",
} as const;
