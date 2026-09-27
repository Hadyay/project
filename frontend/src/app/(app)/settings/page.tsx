"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { Async, Card, Doc, Empty, ErrorNote, Field, Head, Modal, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { count, isoDate, money, today } from "@/lib/format";
import type {
  AlertSettings,
  AlertsSummary,
  Currency,
  ExchangeRate,
  OrgSettings,
  Permission,
  PermissionModule,
  Role,
  User,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Tab = "users" | "roles" | "account" | "org" | "rates" | "alerts";

/** Each tab and the permission that opens it; حسابي is everyone's. */
const TABS: { key: Tab; label: string; permission: Permission | null }[] = [
  { key: "users", label: "المستخدمون", permission: "settings.users" },
  { key: "roles", label: "الأدوار والصلاحيات", permission: "settings.users" },
  { key: "account", label: "حسابي", permission: null },
  { key: "org", label: "بيانات المنشأة", permission: "settings.org" },
  { key: "rates", label: "أسعار الصرف", permission: "settings.rates" },
  { key: "alerts", label: "التنبيهات", permission: "settings.alerts" },
];

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="loading">جارٍ التحميل…</div>}>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const { can, user } = useAuth();
  // Everyone gets here: changing your own password is nobody else's task.
  const visible = TABS.filter((t) => t.permission === null || can(t.permission));
  // ?tab= opens a given tab (the alerts page links to ?tab=alerts).
  const requested = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(
    visible.find((t) => t.key === requested)?.key ?? visible[0]?.key ?? "account",
  );

  return (
    <>
      <Head
        title="الإعدادات والصلاحيات"
        subtitle={`مسجّل الدخول: ${user?.full_name ?? user?.username} — ${user?.role.name ?? ""}`}
      />

      <div className="tabs no-print">
        {visible.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && can("settings.users") ? <UsersPanel /> : null}
      {tab === "roles" && can("settings.users") ? <RolesPanel /> : null}
      {tab === "account" ? <MyAccountPanel /> : null}
      {tab === "org" && can("settings.org") ? <OrgPanel /> : null}
      {tab === "rates" && can("settings.rates") ? <RatesPanel /> : null}
      {tab === "alerts" && can("settings.alerts") ? <AlertsPanel /> : null}
    </>
  );
}

/* ------------------------------------------------------------- المستخدمون */

function UsersPanel() {
  const { user: me, refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [showInactive, setShowInactive] = useState(true);

  const state = useApi(useCallback(() => api.get<User[]>("/api/users"), []), []);
  const roles = useApi(useCallback(() => api.get<Role[]>("/api/roles"), []), []);

  const users = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (state.data ?? []).filter((user) => {
      if (!showInactive && !user.is_active) return false;
      if (roleFilter && String(user.role_id) !== roleFilter) return false;
      if (!needle) return true;
      return (
        user.username.toLowerCase().includes(needle) ||
        (user.full_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [state.data, q, roleFilter, showInactive]);

  async function setActive(user: User, active: boolean) {
    const ok = await confirm({
      title: active ? `إعادة تفعيل ${user.username}؟` : `تعطيل حساب ${user.username}؟`,
      body: active ? (
        <p>سيتمكّن من تسجيل الدخول من جديد بالصلاحيات نفسها.</p>
      ) : (
        <p>
          لن يتمكّن من تسجيل الدخول. الحساب لا يُحذف، وكل ما سجّله في دفتر الأستاذ يبقى منسوباً
          إليه.
        </p>
      ),
      confirmLabel: active ? "تفعيل" : "تعطيل",
      danger: !active,
    });
    if (!ok) return;

    try {
      // Deactivating has its own endpoint (it also guards against removing
      // the last full administrator); reactivating is an ordinary update.
      if (active) await api.patch(`/api/users/${user.id}`, { is_active: true });
      else await api.del(`/api/users/${user.id}`);
      toast.ok(active ? `فُعّل ${user.username}` : `عُطّل ${user.username}`);
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر التنفيذ");
    }
  }

  return (
    <>
      <div className="filters no-print">
        <Field label="بحث" hint="اسم المستخدم أو الاسم الكامل">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="admin…" />
        </Field>
        <Field label="الدور">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">كل الأدوار</option>
            {(roles.data ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الحالة">
          <select value={showInactive ? "" : "active"} onChange={(e) => setShowInactive(!e.target.value)}>
            <option value="">الكل</option>
            <option value="active">النشطون فقط</option>
          </select>
        </Field>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setCreating(true)}>+ مستخدم</button>
      </div>

      <Card title="المستخدمون">
        <Async state={state}>
          {() =>
            users.length === 0 ? (
              <Empty title="لا مستخدمين مطابقين" hint="جرّب مسح البحث." />
            ) : (
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>اسم المستخدم</th>
                      <th>الاسم الكامل</th>
                      <th>الدور</th>
                      <th>الحالة</th>
                      <th>أُنشئ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <Doc>{user.username}</Doc>
                          {user.id === me?.id ? <div className="sub">أنت</div> : null}
                        </td>
                        <td className="nm" translate="no">
                          {user.full_name ?? "—"}
                        </td>
                        <td translate="no">
                          <Pill tone={user.role.is_system ? "dark" : "gray"}>{user.role.name}</Pill>
                        </td>
                        <td>
                          <Pill tone={user.is_active ? "ok" : "late"}>
                            {user.is_active ? "نشط" : "معطّل"}
                          </Pill>
                        </td>
                        <td>
                          <Doc>{isoDate(user.created_at)}</Doc>
                        </td>
                        <td className="num no-print" style={{ whiteSpace: "nowrap" }}>
                          <button className="btn sm" onClick={() => setEditing(user)}>
                            تعديل
                          </button>{" "}
                          <button className="btn sm" onClick={() => setResetting(user)}>
                            كلمة المرور
                          </button>{" "}
                          {user.id !== me?.id ? (
                            <button
                              className={`btn sm${user.is_active ? " danger" : ""}`}
                              onClick={() => setActive(user, !user.is_active)}
                            >
                              {user.is_active ? "تعطيل" : "تفعيل"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </Card>

      {creating || editing ? (
        <UserForm
          key={editing?.id ?? "new"}
          user={editing ?? undefined}
          roles={roles.data ?? []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(message) => {
            setCreating(false);
            setEditing(null);
            toast.ok(message);
            state.reload();
            void refresh(); // your own role may have changed
          }}
        />
      ) : null}

      {resetting ? (
        <ResetPasswordForm
          key={resetting.id}
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={(message) => {
            setResetting(null);
            toast.ok(message);
          }}
        />
      ) : null}
    </>
  );
}

function UserForm({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user?: User;
  roles: Role[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = user !== undefined;
  const fallbackRole = roles.find((role) => role.code === "viewer") ?? roles[roles.length - 1];
  const [form, setForm] = useState({
    username: user?.username ?? "",
    password: "",
    full_name: user?.full_name ?? "",
    role_id: String(user?.role_id ?? fallbackRole?.id ?? ""),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = roles.find((role) => String(role.id) === form.role_id);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.patch(`/api/users/${user.id}`, {
          full_name: form.full_name || null,
          role_id: Number(form.role_id),
        });
      } else {
        await api.post("/api/users", {
          username: form.username,
          password: form.password,
          full_name: form.full_name || null,
          role_id: Number(form.role_id),
        });
      }
      onSaved(editing ? `حُفظ ${form.username}` : `أُضيف المستخدم ${form.username}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(form.role_id) && (editing || (form.username.trim().length >= 3 && form.password.length >= 6));

  return (
    <Modal
      title={editing ? `تعديل المستخدم ${user.username}` : "مستخدم جديد"}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy || !ready}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="form-row">
        <Field label="اسم المستخدم" hint={editing ? "لا يتغيّر بعد الإنشاء" : undefined}>
          <input
            className="mono-in"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            disabled={editing}
            autoFocus={!editing}
          />
        </Field>
        {editing ? (
          <Field label="كلمة المرور">
            <input value="••••••••" disabled />
          </Field>
        ) : (
          <Field label="كلمة المرور" hint="٦ أحرف على الأقل">
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
        )}
      </div>

      <div className="form-row">
        <Field label="الاسم الكامل">
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="الدور">
          <select value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {chosen ? (
        <div className="note">
          <span>◈</span>
          <span>
            {chosen.is_system
              ? "كل الصلاحيات، بما فيها إدارة المستخدمين والأدوار."
              : `${count(chosen.permissions.length)} صلاحية${chosen.description ? ` — ${chosen.description}` : ""}`}{" "}
            الأدوار وصلاحياتها تُعدَّل من تبويب «الأدوار والصلاحيات»، ويسري التغيير فوراً.
          </span>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------ الأدوار والصلاحيات */

function RolesPanel() {
  const { refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const roles = useApi(useCallback(() => api.get<Role[]>("/api/roles"), []), []);
  const catalog = useApi(useCallback(() => api.get<PermissionModule[]>("/api/roles/permissions"), []), []);
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState<Role | "blank" | null>(null);
  const total = (catalog.data ?? []).reduce((n, module) => n + module.actions.length, 0);

  async function remove(role: Role) {
    const ok = await confirm({
      title: `حذف الدور ${role.name}؟`,
      body: <p>لا يمكن حذف دور مُسند إلى مستخدمين. المستخدمون أنفسهم لا يتأثّرون.</p>,
      confirmLabel: "حذف",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/roles/${role.id}`);
      toast.ok(`حُذف الدور ${role.name}`);
      roles.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر الحذف");
    }
  }

  return (
    <>
      <div className="filters no-print">
        <div className="note" style={{ margin: 0, flex: 1 }}>
          <span>◈</span>
          <span>
            الدور مجموعة صلاحيات على الشاشات والإجراءات. يُسند كل مستخدم إلى دور، وأي تعديل هنا يسري فوراً على كل
            مستخدمي الدور — في الخادم مع الطلب التالي، وفي قوائمهم خلال دقيقة.
          </span>
        </div>
        <button className="btn primary" onClick={() => setCreating("blank")}>+ دور جديد</button>
      </div>

      <Card title="الأدوار">
        <Async state={roles}>
          {(list) => (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الدور</th>
                    <th>الوصف</th>
                    <th className="num">الصلاحيات</th>
                    <th className="num">المستخدمون</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((role) => (
                    <tr key={role.id}>
                      <td>
                        <div className="nm" translate="no">
                          {role.name}
                        </div>
                        <span className="sub mono">{role.code}</span>
                        {role.is_system ? (
                          <>
                            {" "}
                            <Pill tone="dark">ثابت</Pill>
                          </>
                        ) : null}
                      </td>
                      <td className="sub" translate="no">
                        {role.description ?? "—"}
                      </td>
                      <td className="num">
                        <span className="mono">
                          {count(role.permissions.length)} / {count(total)}
                        </span>
                      </td>
                      <td className="num">
                        <span className="mono">{count(role.user_count)}</span>
                      </td>
                      <td className="num no-print" style={{ whiteSpace: "nowrap" }}>
                        <button className="btn sm" onClick={() => setEditing(role)}>
                          {role.is_system ? "عرض" : "تعديل"}
                        </button>{" "}
                        <button className="btn sm" onClick={() => setCreating(role)} title="دور جديد يبدأ بصلاحيات هذا الدور">
                          نسخ
                        </button>{" "}
                        {!role.is_system ? (
                          <button className="btn sm danger" onClick={() => remove(role)} disabled={role.user_count > 0}>
                            حذف
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </Card>

      {(editing || creating) && catalog.data ? (
        <RoleForm
          key={editing?.id ?? (creating === "blank" ? "new" : `copy-${(creating as Role).id}`)}
          role={editing ?? undefined}
          copyOf={creating && creating !== "blank" ? creating : undefined}
          catalog={catalog.data}
          onClose={() => {
            setEditing(null);
            setCreating(null);
          }}
          onSaved={(message) => {
            setEditing(null);
            setCreating(null);
            toast.ok(message);
            roles.reload();
            void refresh(); // the editor's own role may be the one changed
          }}
        />
      ) : null}
    </>
  );
}

function RoleForm({
  role,
  copyOf,
  catalog,
  onClose,
  onSaved,
}: {
  role?: Role;
  copyOf?: Role;
  catalog: PermissionModule[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = role !== undefined;
  const locked = Boolean(role?.is_system);
  const [name, setName] = useState(role?.name ?? (copyOf ? `${copyOf.name} (نسخة)` : ""));
  const [code, setCode] = useState(role?.code ?? "");
  const [description, setDescription] = useState(role?.description ?? copyOf?.description ?? "");
  const [granted, setGranted] = useState<Set<Permission>>(
    new Set(role?.permissions ?? (copyOf && !copyOf.is_system ? copyOf.permissions : copyOf ? copyOf.permissions : [])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const all = catalog.flatMap((module) => module.actions.map((a) => a.code));

  /** Ticking an action ticks the module's view too (you cannot act on a
   *  screen you cannot open); unticking view clears the module's actions. */
  function toggle(module: PermissionModule, permission: Permission) {
    if (locked) return;
    const next = new Set(granted);
    const view = module.actions.find((a) => a.action === "view")?.code;
    if (next.has(permission)) {
      next.delete(permission);
      if (permission === view) module.actions.forEach((a) => next.delete(a.code));
    } else {
      next.add(permission);
      if (view) next.add(view);
    }
    setGranted(next);
  }

  function setModule(module: PermissionModule, on: boolean) {
    if (locked) return;
    const next = new Set(granted);
    module.actions.forEach((a) => (on ? next.add(a.code) : next.delete(a.code)));
    setGranted(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const permissions = [...granted];
    try {
      if (editing) {
        await api.patch(`/api/roles/${role.id}`, { name, description: description || null, permissions });
        onSaved(`حُفظ الدور ${name}`);
      } else {
        await api.post("/api/roles", { code, name, description: description || null, permissions });
        onSaved(`أُضيف الدور ${name}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  const codeOk = editing || /^[a-z][a-z0-9_]{1,39}$/.test(code);
  const ready = !locked && name.trim().length >= 2 && codeOk;

  return (
    <Modal
      title={locked ? `${role?.name} — كل الصلاحيات` : editing ? `تعديل الدور ${role.name}` : "دور جديد"}
      onClose={onClose}
      wide
      footer={
        <>
          {!locked ? (
            <button className="btn primary" onClick={save} disabled={busy || !ready}>
              {busy ? "جارٍ الحفظ…" : "حفظ"}
            </button>
          ) : null}
          <button className="btn" onClick={onClose}>
            {locked ? "إغلاق" : "إلغاء"}
          </button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}
      {locked ? (
        <div className="note">
          <span>◈</span>
          <span>دور مدير النظام ثابت: يملك كل الصلاحيات دائماً، بما فيها ما يُضاف مستقبلاً، ولا يُعدَّل ولا يُحذف.</span>
        </div>
      ) : null}

      <div className="form-row">
        <Field label="اسم الدور">
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} autoFocus={!editing} />
        </Field>
        <Field label="الرمز" hint={editing ? "لا يتغيّر بعد الإنشاء" : "أحرف لاتينية صغيرة وأرقام و _ — مثلاً cashier"}>
          <input
            className="mono-in"
            value={code}
            onChange={(e) => setCode(e.target.value.toLowerCase())}
            disabled={editing}
          />
        </Field>
      </div>
      <Field label="الوصف">
        <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} />
      </Field>

      <div className="perm-head">
        <b>الصلاحيات</b>
        <span className="sub mono">
          {count(locked ? all.length : granted.size)} / {count(all.length)}
        </span>
        <div className="spacer" style={{ flex: 1 }} />
        {!locked ? (
          <>
            <button className="btn sm" onClick={() => setGranted(new Set(all))}>
              تحديد الكل
            </button>
            <button className="btn sm" onClick={() => setGranted(new Set())}>
              إلغاء الكل
            </button>
          </>
        ) : null}
      </div>
      <div className="perm-grid">
        {catalog.map((module) => {
          const on = module.actions.filter((a) => locked || granted.has(a.code)).length;
          return (
            <div className={`perm-row${on ? " some" : ""}`} key={module.module}>
              <label className="perm-module">
                <input
                  type="checkbox"
                  checked={on === module.actions.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < module.actions.length;
                  }}
                  onChange={(e) => setModule(module, e.target.checked)}
                  disabled={locked}
                />
                <span>{module.label}</span>
              </label>
              <div className="perm-actions">
                {module.actions.map((action) => (
                  <label key={action.code} className={`perm-chip${locked || granted.has(action.code) ? " on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={locked || granted.has(action.code)}
                      onChange={() => toggle(module, action.code)}
                      disabled={locked}
                    />
                    {action.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** An admin setting someone else's password — no old password to ask for. */
function ResetPasswordForm({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/users/${user.id}`, { password });
      onSaved(`غُيّرت كلمة مرور ${user.username}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  const mismatch = again.length > 0 && password !== again;

  return (
    <Modal
      title={`كلمة مرور ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn primary"
            onClick={save}
            disabled={busy || password.length < 6 || password !== again}
          >
            {busy ? "جارٍ الحفظ…" : "تعيين"}
          </button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="note">
        <span>◈</span>
        <span>ستحلّ محلّ كلمة المرور الحالية فوراً. أبلغ المستخدم بها بنفسك — النظام لا يرسلها.</span>
      </div>

      <Field label="كلمة المرور الجديدة" hint="٦ أحرف على الأقل">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
      <Field label="تأكيد كلمة المرور" error={mismatch ? "لا تطابق" : undefined}>
        <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ حسابي */

/** Changing your own password. Needs the current one, so a borrowed session
 *  cannot lock the real owner out. */
function MyAccountPanel() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const weak = next.length > 0 && next.length < 6;
  const mismatch = again.length > 0 && next !== again;
  const ready = current.length > 0 && next.length >= 6 && next === again;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      toast.ok("تم تغيير كلمة المرور — سجّل الدخول من جديد");
      setCurrent("");
      setNext("");
      setAgain("");
      // The old token still works until it expires, but signing out makes the
      // change unambiguous and proves the new password on the way back in.
      logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تغيير كلمة المرور");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2">
      <Card title="تغيير كلمة المرور">
        <div className="card-b">
          {error ? <ErrorNote message={error} /> : null}

          <Field label="كلمة المرور الحالية">
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field
            label="كلمة المرور الجديدة"
            hint="٦ أحرف على الأقل"
            error={weak ? "قصيرة جداً" : undefined}
          >
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="تأكيد كلمة المرور" error={mismatch ? "لا تطابق" : undefined}>
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>

          <button className="btn primary" onClick={save} disabled={busy || !ready} style={{ marginTop: 6 }}>
            {busy ? "جارٍ الحفظ…" : "تغيير كلمة المرور"}
          </button>
        </div>
      </Card>

      <Card title="حسابي">
        <div className="card-b">
          <div className="kv">
            <span>اسم المستخدم</span>
            <b className="mono">{user?.username}</b>
          </div>
          <div className="kv">
            <span>الاسم الكامل</span>
            <b>{user?.full_name ?? "—"}</b>
          </div>
          <div className="kv">
            <span>الدور</span>
            <b translate="no">{user?.role.name ?? "—"}</b>
          </div>
          <div className="kv">
            <span>تاريخ الإنشاء</span>
            <b className="mono">{isoDate(user?.created_at)}</b>
          </div>

          <div className="note" style={{ marginTop: 12 }}>
            <span>◈</span>
            <span>الاسم والدور يغيّرهما مدير النظام من تبويب المستخدمين.</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------- بيانات المنشأة */

/** The letterhead every printed document carries. */
function OrgPanel() {
  const toast = useToast();
  const state = useApi(useCallback(() => api.get<OrgSettings>("/api/org-settings"), []), []);

  return (
    <Async state={state}>{(org) => <OrgForm key={org.updated_at} org={org} toast={toast} />}</Async>
  );
}

function OrgForm({
  org,
  toast,
}: {
  org: OrgSettings;
  toast: { ok: (m: string) => void; err: (m: string) => void };
}) {
  const [form, setForm] = useState({
    name: org.name,
    subtitle: org.subtitle ?? "",
    address: org.address ?? "",
    phone: org.phone ?? "",
    email: org.email ?? "",
    tax_no: org.tax_no ?? "",
    footer_note: org.footer_note ?? "",
  });
  const [logo, setLogo] = useState<string | null>(org.logo);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Read the picked file straight into a data URI.
   *
   *  The logo is stored inline in the settings row — the app has no file
   *  store, and a letterhead that travels with a pg_dump is a letterhead that
   *  still prints after a restore. The cap mirrors the server's. */
  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.err("اختر ملف صورة (PNG أو JPEG أو SVG)");
      return;
    }
    if (file.size > 300 * 1024) {
      toast.err(`الصورة ${Math.round(file.size / 1024)} كيلوبايت — الحدّ ٣٠٠. اختر صورة أصغر.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => toast.err("تعذّرت قراءة الملف");
    reader.readAsDataURL(file);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/org-settings", {
        name: form.name,
        subtitle: form.subtitle || null,
        address: form.address || null,
        phone: form.phone || null,
        email: form.email || null,
        tax_no: form.tax_no || null,
        footer_note: form.footer_note || null,
        logo: logo || null,
      });
      toast.ok("حُفظت بيانات المنشأة");
    } catch (err) {
      const message = err instanceof Error ? err.message : "تعذّر الحفظ";
      setError(message);
      toast.err(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2">
      <Card title="بيانات المنشأة">
        <div className="card-b">
          {error ? <ErrorNote message={error} /> : null}

          <div className="note">
            <span>◈</span>
            <span>
              تظهر هذه البيانات في ترويسة كل سند وكشف وتقرير يُطبع من النظام. تُحفظ على الخادم، فكل
              من يطبع يحصل على الورقة نفسها.
            </span>
          </div>

          <div className="form-row">
            <Field label="اسم المنشأة">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="الوصف" hint="يظهر بجانب الاسم">
              <input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
            </Field>
          </div>

          <Field label="العنوان">
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>

          <div className="form-row">
            <Field label="الهاتف">
              <input className="mono-in" value={form.phone}
                     onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="البريد الإلكتروني">
              <input className="mono-in" type="email" value={form.email}
                     onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>

          <div className="form-row">
            <Field label="الرقم الضريبي">
              <input className="mono-in" value={form.tax_no}
                     onChange={(e) => setForm({ ...form, tax_no: e.target.value })} />
            </Field>
            <Field label="سطر أسفل السند" hint="شكر أو شرط مطبوع على كل سند">
              <input value={form.footer_note}
                     onChange={(e) => setForm({ ...form, footer_note: e.target.value })} />
            </Field>
          </div>

          <Field label="الشعار" hint="PNG أو JPEG أو SVG — حتى ٣٠٠ كيلوبايت، يظهر على كل مستند مطبوع">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => pickLogo(e.target.files?.[0])}
              />
              {logo ? (
                <button className="btn sm danger" onClick={() => setLogo(null)}>
                  إزالة الشعار
                </button>
              ) : null}
            </div>
          </Field>

          <button className="btn primary" onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
        </div>
      </Card>

      <Card title="معاينة الترويسة" actions={<span className="sub">كما ستُطبع</span>}>
        <div className="card-b">
          <div className="sheet" style={{ padding: "20px 22px", maxWidth: "none" }}>
            <div className="sheet-head" style={{ marginBottom: 0, paddingBottom: 12 }}>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- inline data URI
                <img className="sheet-logo" src={logo} alt="" />
              ) : null}
              <div>
                <h2>سند قبض</h2>
                <div className="org">
                  {form.name}
                  {form.subtitle ? ` — ${form.subtitle}` : ""}
                </div>
                {form.address || form.phone ? (
                  <div className="org">{[form.address, form.phone].filter(Boolean).join(" · ")}</div>
                ) : null}
                {form.tax_no ? <div className="org">رقم ضريبي: {form.tax_no}</div> : null}
              </div>
              <div className="spacer" style={{ flex: 1 }} />
              <div className="sheet-no">
                <span>رقم السند</span>
                <b>LEG-R-24</b>
                <span>{today()}</span>
              </div>
            </div>
            {form.footer_note ? (
              <div className="sub" style={{ paddingTop: 10 }}>{form.footer_note}</div>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ أسعار الصرف */

/* ------------------------------------------------------------- التنبيهات */

/** The monthly payment reminder: which day of the month it opens, whether it
 *  runs, and the smallest balance worth chasing. Takes effect at once — the
 *  late list is computed live, nothing is scheduled. */
function AlertsPanel() {
  const toast = useToast();
  const state = useApi(useCallback(() => api.get<AlertSettings>("/api/alerts/settings"), []), []);
  const preview = useApi(useCallback(() => api.get<AlertsSummary>("/api/alerts/summary"), []), []);
  const [form, setForm] = useState<{ enabled: boolean; alert_day: number; min_balance: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = form ?? (state.data
    ? { enabled: state.data.enabled, alert_day: state.data.alert_day, min_balance: String(Number(state.data.min_balance)) }
    : null);

  async function save() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/alerts/settings", {
        enabled: current.enabled,
        alert_day: current.alert_day,
        min_balance: current.min_balance || "0",
      });
      toast.ok("حُفظ إعداد التنبيهات");
      setForm(null);
      state.reload();
      preview.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <Card title="تنبيه الدفعات الشهرية" padded>
        {error ? <ErrorNote message={error} /> : null}
        {!current ? (
          <div className="loading">جارٍ التحميل…</div>
        ) : (
          <>
            <label className="perm-module" style={{ marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={current.enabled}
                onChange={(e) => setForm({ ...current, enabled: e.target.checked })}
              />
              <span>التنبيه مفعّل</span>
            </label>

            <Field label="يوم التنبيه من كل شهر" hint="من هذا اليوم يُعلَّم كل عميل مدين لم يدفع دفعة الشهر باللون الأحمر">
              <div className="day-pick">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={`day${current.alert_day === day ? " on" : ""}`}
                    onClick={() => setForm({ ...current, alert_day: day })}
                    disabled={!current.enabled}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="أقل رصيد يُنبَّه عليه ($)" hint="العملاء الذين رصيدهم أقل من هذا لا يظهرون — ٠ = كل مدين">
              <input
                className="mono-in"
                inputMode="decimal"
                value={current.min_balance}
                onChange={(e) => setForm({ ...current, min_balance: e.target.value })}
                disabled={!current.enabled}
              />
            </Field>

            <button className="btn primary" onClick={save} disabled={busy || form === null}>
              {busy ? "جارٍ الحفظ…" : "حفظ"}
            </button>
          </>
        )}
      </Card>

      <Card title="كيف يعمل التنبيه" padded>
        <ul className="how">
          <li>
            {`في يوم ${current?.alert_day ?? 1} من كل شهر يُفتح تنبيه الشهر: كل عميل عليه رصيد ولم يدفع شيئاً منذ بداية الشهر يظهر بالأحمر في العملاء والتنبيهات وكشف حسابه.`}
          </li>
          <li>إذا حُدِّد للعميل «قسط شهري» في بطاقته، فدفع أقل منه يُعدّ متأخراً أيضاً.</li>
          <li>أقساط العقود المستحقّة وغير المسدّدة تُعدّ متأخرة دائماً.</li>
          <li>تسجيل وصل القبض يُزيل التنبيه فوراً — لا شيء يُشغَّل يدوياً.</li>
          <li>أول من يفتح النظام بعد يوم التنبيه يرى نافذة تذكير، والجرس أعلى الشاشة يعرض العدد.</li>
        </ul>
        {preview.data ? (
          <div className="late-banner" style={{ marginTop: 12 }}>
            <span style={{ fontSize: 22 }}>🔔</span>
            <div>
              <b>{`${preview.data.count} عميل متأخر الآن`}</b>
              <div className="sub">{`دورة ${preview.data.period} — فُتحت ${preview.data.alert_date}`}</div>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function RatesPanel() {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const currencies = useApi(useCallback(() => api.get<Currency[]>("/api/currencies"), []), []);
  const rates = useApi(useCallback(() => api.get<ExchangeRate[]>("/api/exchange-rates", { limit: 100 }), []), []);

  const codeOf = (id: number) => currencies.data?.find((c) => c.id === id)?.code ?? String(id);

  return (
    <>
      <Card
        title="أسعار الصرف"
        actions={<button className="btn primary" onClick={() => setAdding(true)}>+ سعر صرف</button>}
      >
        <Async state={rates}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty
                title="لا أسعار صرف"
                hint="أضف سعراً لكل عملة غير أساسية — القيد بعملة بلا سعر يُرفض، ولا يُخمَّن سعر أبداً."
              />
            ) : (
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>العملة</th>
                      <th>التاريخ</th>
                      <th className="num">مقابل العملة الأساسية</th>
                      <th className="num">الوحدات لكل دولار</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((rate) => (
                      <tr key={rate.id}>
                        <td><Doc>{codeOf(rate.currency_id)}</Doc></td>
                        <td><Doc>{isoDate(rate.rate_date)}</Doc></td>
                        <td className="num mono">{money(rate.rate_to_base, 6)}</td>
                        <td className="num mono">
                          {Number(rate.rate_to_base) ? money(1 / Number(rate.rate_to_base), 2) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </Card>

      {adding ? (
        <RateForm
          currencies={currencies.data ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            toast.ok("أُضيف سعر الصرف");
            rates.reload();
          }}
        />
      ) : null}
    </>
  );
}

function RateForm({
  currencies,
  onClose,
  onSaved,
}: {
  currencies: Currency[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const nonBase = currencies.filter((c) => !c.is_base);
  const [form, setForm] = useState({
    currency_id: String(nonBase[0]?.id ?? ""),
    rate_date: today(),
    per_base: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // The office quotes "ل.ل per dollar"; the schema stores the inverse.
      const perBase = Number(form.per_base);
      await api.post("/api/exchange-rates", {
        currency_id: Number(form.currency_id),
        rate_date: form.rate_date,
        rate_to_base: (1 / perBase).toFixed(6),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="سعر صرف جديد"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn primary"
            onClick={save}
            disabled={busy || !form.currency_id || Number(form.per_base) <= 0}
          >
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="form-row">
        <Field label="العملة">
          <select value={form.currency_id} onChange={(e) => setForm({ ...form, currency_id: e.target.value })}>
            {nonBase.map((c) => (
              <option key={c.id} value={c.id}>{c.name_ar} ({c.code})</option>
            ))}
          </select>
        </Field>
        <Field label="التاريخ">
          <input className="mono-in" type="date" value={form.rate_date}
                 onChange={(e) => setForm({ ...form, rate_date: e.target.value })} />
        </Field>
      </div>

      <Field label="الوحدات لكل دولار" hint="مثلاً ٩٠٠٠٠ ليرة للدولار الواحد">
        <input className="mono-in" type="number" step="0.0001" value={form.per_base}
               onChange={(e) => setForm({ ...form, per_base: e.target.value })} autoFocus />
      </Field>

      {Number(form.per_base) > 0 ? (
        <div className="note">
          <span>◈</span>
          <span>
            يُخزَّن كـ <span className="mono">{(1 / Number(form.per_base)).toFixed(6)}</span> — قيمة
            الوحدة الواحدة بالعملة الأساسية.
          </span>
        </div>
      ) : null}
    </Modal>
  );
}
