"use client";

import { useParams } from "next/navigation";

import { Voucher } from "@/components/Voucher";

export default function PaymentPrintPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  if (!Number.isFinite(id)) return <div className="alert err">رقم سند غير صالح</div>;
  return <Voucher kind="payment" id={id} />;
}
