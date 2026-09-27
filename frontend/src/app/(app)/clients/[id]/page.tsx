"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Statement } from "@/components/Statement";
import { Head } from "@/components/ui";

export default function ClientStatementPage() {
  const params = useParams<{ id: string }>();
  const clientId = Number(params.id);

  if (!Number.isFinite(clientId)) {
    return <div className="alert err">معرّف عميل غير صالح</div>;
  }

  return (
    <>
      <Head
        title="كشف حساب"
        subtitle="حركة حساب العميل في دفتر الأستاذ"
        actions={
          <Link className="btn" href="/clients">
            ← العملاء
          </Link>
        }
      />
      <Statement clientId={clientId} />
    </>
  );
}
