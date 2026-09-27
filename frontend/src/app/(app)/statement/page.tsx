"use client";

import { useCallback, useState } from "react";

import { SearchSelect } from "@/components/SearchSelect";
import { Statement } from "@/components/Statement";
import { Empty, Field, Head } from "@/components/ui";
import { api } from "@/lib/api";
import type { Client, Page } from "@/lib/types";
import { ALL_ROWS } from "@/lib/paging";
import { useApi } from "@/lib/useApi";

/** The standalone كشف حساب screen: pick a client, then the same ledger sheet
 *  the client profile shows. */
export default function StatementPage() {
  const [clientId, setClientId] = useState("");

  const fetcher = useCallback(() => api.get<Page<Client>>("/api/clients", { limit: ALL_ROWS }), []);
  const clients = useApi(fetcher, []);

  return (
    <>
      <Head title="كشف حساب" subtitle="اختر عميلاً لعرض حركة حسابه" />

      <div className="filters no-print">
        <Field label="العميل" hint="اكتب جزءاً من الاسم أو رقم الحساب">
          <SearchSelect
            options={(clients.data?.items ?? []).map((client) => ({
              id: client.id,
              label: client.name_ar,
              hint: client.code,
            }))}
            value={clientId}
            onChange={setClientId}
            placeholder="اكتب اسم العميل…"
          />
        </Field>
        {clientId ? (
          <button className="btn" onClick={() => setClientId("")}>
            عميل آخر
          </button>
        ) : null}
      </div>

      {clientId ? (
        <Statement clientId={Number(clientId)} />
      ) : (
        <div className="card">
          <Empty
            title="لم يُختر عميل"
            hint={`اكتب اسم العميل في الحقل أعلاه — ${clients.data?.total ?? 0} عميل في السجل.`}
          />
        </div>
      )}
    </>
  );
}
