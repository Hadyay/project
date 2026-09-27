"use client";

import { useParams } from "next/navigation";

import { Voucher } from "@/components/Voucher";

export default function ReceiptPrintPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  if (!Number.isFinite(id)) return <div className="alert err">رقم وصل غير صالح</div>;
  return <Voucher kind="receipt" id={id} />;
}
