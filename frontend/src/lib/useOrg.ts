"use client";

import { useCallback } from "react";

import { api } from "@/lib/api";
import { ORG } from "@/lib/org";
import type { OrgSettings } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** The letterhead, from the server, with the built-in default as a floor.
 *
 *  Printing must never fail because a settings fetch did: a voucher with the
 *  stock heading is still a valid voucher, a voucher with a blank heading is
 *  not. `lib/org.ts` stays as that floor and as the seed for a fresh database.
 */
export function useOrg(): OrgSettings {
  const state = useApi(
    useCallback(() => api.get<OrgSettings>("/api/org-settings"), []),
    [],
  );

  return (
    state.data ?? {
      name: ORG.name,
      subtitle: ORG.subtitle,
      address: null,
      phone: null,
      email: null,
      tax_no: null,
      footer_note: null,
      logo: null,
      updated_at: "",
    }
  );
}
