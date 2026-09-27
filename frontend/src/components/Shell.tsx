"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { BackToTop, PrintHeader } from "@/components/Filters";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useAlertSummary } from "@/lib/alerts";
import { Modal } from "@/components/ui";
import { initial, money, today } from "@/lib/format";
import { useOrg } from "@/lib/useOrg";
import type { Currency, ExchangeRate, Permission } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** What opens the screen; null = everyone (الإعدادات always has حسابي). */
  permission: Permission | null;
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "التشغيل",
    items: [
      { href: "/", label: "لوحة التحكم", icon: "◱", permission: "dashboard.view" },
      { href: "/buildings", label: "الأبنية", icon: "▤", permission: "buildings.view" },
      { href: "/units", label: "الشقق والوحدات", icon: "▦", permission: "units.view" },
      { href: "/clients", label: "العملاء", icon: "◉", permission: "clients.view" },
      { href: "/contracts", label: "العقود", icon: "▭", permission: "contracts.view" },
      { href: "/schedule", label: "جدول الدفعات", icon: "◷", permission: "schedule.view" },
      { href: "/alerts", label: "التنبيهات", icon: "🔔", permission: "alerts.view" },
    ],
  },
  {
    label: "المالية",
    items: [
      { href: "/statement", label: "كشف حساب عميل", icon: "▥", permission: "clients.view" },
      { href: "/receipts", label: "الوصولات — قبض", icon: "↓", permission: "receipts.view" },
      { href: "/payments", label: "المدفوعات — صرف", icon: "↑", permission: "payments.view" },
      { href: "/journal", label: "قيود اليومية", icon: "≡", permission: "journal.view" },
      { href: "/trial", label: "ميزان المراجعة", icon: "⚖", permission: "reports.view" },
      { href: "/accounts", label: "دليل الحسابات", icon: "☰", permission: "accounts.view" },
    ],
  },
  {
    label: "النظام",
    items: [
      { href: "/reports", label: "التقارير", icon: "▧", permission: "reports.view" },
      { href: "/settings", label: "الإعدادات والصلاحيات", icon: "⚙", permission: null },
    ],
  },
];

const CRUMB: Record<string, string> = {
  "/": "نظرة عامة",
  "/buildings": "المجمّع",
  "/units": "الجرد",
  "/clients": "السجل",
  "/contracts": "البيع والإيجار",
  "/schedule": "الاستحقاقات",
  "/statement": "كشف حساب",
  "/receipts": "قبض",
  "/payments": "صرف",
  "/journal": "دفتر اليومية",
  "/trial": "ميزان",
  "/accounts": "الشجرة",
  "/reports": "التقارير",
  "/settings": "النظام",
};

function activeItem(pathname: string): NavItem | undefined {
  const all = NAV.flatMap((group) => group.items);
  // Longest matching prefix wins, so /clients/12 highlights "العملاء".
  return all
    .filter((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** The topbar's exchange-rate chip: today's effective rate for the non-base
 *  currency the office actually quotes in. Silent when no rate is on file —
 *  an ERP should not display a number it had to invent. */
function RateChip() {
  const [text, setText] = useState<{ value: string; label: string } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const currencies = await api.get<Currency[]>("/api/currencies");
        const base = currencies.find((c) => c.is_base);
        const quoted = currencies.find((c) => !c.is_base && c.code === "LBP") ?? currencies.find((c) => !c.is_base);
        if (!quoted || !base) return;

        const rates = await api.get<ExchangeRate[]>("/api/exchange-rates", {
          currency_id: quoted.id,
          limit: 1,
        });
        if (!live || rates.length === 0) return;

        // Rates are stored as "1 unit of currency = X base"; the office reads
        // the inverse (how many ل.ل to the dollar).
        const perBase = 1 / Number(rates[0].rate_to_base);
        setText({
          value: money(perBase, 0),
          label: `${quoted.symbol ?? quoted.code} / ${base.symbol ?? base.code}`,
        });
      } catch {
        /* the chip is decorative — never block the shell on it */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!text) return null;

  return (
    <div className="rate" title="سعر الصرف المعتمد">
      <div className="rate-lbl">سعر الصرف</div>
      <div className="rate-val">
        <b>{text.value}</b>
        <small>{text.label}</small>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout, can } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  // Desktop: the menu can be hidden to give tables the whole width, and the
  // choice is remembered. Phones keep the slide-in menu (navOpen).
  const [navHidden, setNavHidden] = useState(false);
  const { lang, setLang } = useLang();
  const alerts = useAlertSummary();
  const org = useOrg();

  useEffect(() => {
    try {
      setNavHidden(window.localStorage.getItem("erp.navHidden") === "1");
    } catch {
      /* storage blocked - menu stays shown */
    }
  }, []);

  function toggleNav() {
    if (window.matchMedia("(max-width: 760px)").matches) {
      setNavOpen((v) => !v);
      return;
    }
    setNavHidden((hidden) => {
      try {
        window.localStorage.setItem("erp.navHidden", hidden ? "0" : "1");
      } catch {
        /* not remembered */
      }
      return !hidden;
    });
  }

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (loading) return <div className="loading">جارٍ التحميل…</div>;
  if (!user) return null;

  const current = activeItem(pathname);
  const allowed = (item: NavItem) => item.permission === null || can(item.permission);
  const menu = NAV.map((group) => ({ ...group, items: group.items.filter(allowed) })).filter(
    (group) => group.items.length > 0,
  );
  // A screen the role does not open says so rather than failing on 403s.
  // The first screen is the dashboard only for those who may see it.
  const blocked = current !== undefined && !allowed(current);
  const home = menu[0]?.items[0]?.href ?? "/settings";

  return (
    <div className={`app${navHidden ? " nav-hidden" : ""}`}>
      <aside className={`nav${navOpen ? " open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <span className="sq">
              <i />
              <i />
              <i />
              <i />
            </span>
            إدارة العقارات
          </div>
          <div className="brand-sub" translate="no">{org.name}</div>
        </div>

        {menu.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => (
              <Link key={item.href} href={item.href} className={current?.href === item.href ? "on" : ""}>
                <span className="ic">{item.icon}</span> {item.label}
                {item.href === "/alerts" && alerts.summary?.count ? (
                  <span className="nav-badge">{alerts.summary.count}</span>
                ) : null}
              </Link>
            ))}
          </div>
        ))}

        <div className="nav-foot">
          {user.full_name ?? user.username}
          <br />
          <button
            className="btn sm"
            style={{ marginTop: 8, background: "transparent", color: "var(--nav-text)", borderColor: "rgba(255,255,255,.16)" }}
            onClick={logout}
          >
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="nav-toggle"
            onClick={toggleNav}
            aria-label={navHidden ? "إظهار القائمة" : "إخفاء القائمة"}
            title={navHidden ? "إظهار القائمة" : "إخفاء القائمة"}
          >
            ☰
          </button>
          <div className="crumb">
            {current?.label ?? "—"}
            <small>{CRUMB[current?.href ?? ""] ?? ""}</small>
          </div>
          <div className="spacer" />
          <RateChip />
          {alerts.summary && can("alerts.view") ? (
            <Link
              href="/alerts"
              className={`bell${alerts.summary.count ? " ring" : ""}`}
              title={alerts.summary.count ? `${alerts.summary.count} عميل لم يدفع` : "لا تنبيهات"}
            >
              🔔
              {alerts.summary.count ? <span className="bell-n">{alerts.summary.count}</span> : null}
            </Link>
          ) : null}
          <ThemeToggle />
          <button
            className="lang-toggle"
            translate="no"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            title={lang === "ar" ? "English" : "العربية"}
          >
            {lang === "ar" ? "EN" : "ع"}
          </button>
          <div className="avatar" title={`${user.full_name ?? user.username}`}>
            {initial(user.full_name ?? user.username)}
          </div>
        </header>

        <div className="wrap">
          {/* Paper-only. Every screen prints with the firm's heading, the
              screen's name and the date, without each one repeating it. */}
          <PrintHeader
            title={current?.label ?? "تقرير"}
            period={`طُبع ${today()}`}
            org={org}
          />
          {blocked ? <NoAccess home={pathname === "/" ? home : null} /> : children}
        </div>
      </div>

      <BackToTop />
      {alerts.summary && can("alerts.view") ? <PaymentAlarm userId={user.id} summary={alerts.summary} /> : null}
    </div>
  );
}

/** Light ⇄ dark in one click; "follow Windows" is in الإعدادات ← المظهر. */
function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      className="theme-toggle"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "الوضع الفاتح" : "الوضع الداكن"}
      aria-label={dark ? "الوضع الفاتح" : "الوضع الداكن"}
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}

/** Shown instead of a screen the user's role does not open. On the landing
 *  page it forwards to the first screen they may use instead. */
function NoAccess({ home }: { home: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (home && home !== "/") router.replace(home);
  }, [home, router]);
  if (home) return <div className="loading">جارٍ التحميل…</div>;
  return (
    <div className="card no-access">
      <div className="na-ic">⛔</div>
      <h3 style={{ margin: "8px 0 6px" }}>ليست لديك صلاحية لهذه الشاشة</h3>
      <p className="sub">
        دورك لا يتضمّن الاطلاع عليها. إن كنت تحتاجها فاطلب من مدير النظام إضافة الصلاحية إلى دورك من
        «الإعدادات ← الأدوار والصلاحيات».
      </p>
    </div>
  );
}

/** The alarm: the first time someone opens the system in a new reminder cycle
 *  (on or after the alert day set in الإعدادات ← التنبيهات), say how many
 *  clients have not paid. Once per cycle per user in this browser — after
 *  that the bell carries the count. */
function PaymentAlarm({ userId, summary }: { userId: number; summary: import("@/lib/types").AlertsSummary }) {
  const router = useRouter();
  const key = `erp.alarm.${userId}.${summary.period}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!summary.count) return;
    try {
      if (window.localStorage.getItem(key)) return;
    } catch {
      /* storage blocked: show it every visit rather than never */
    }
    setOpen(true);
  }, [key, summary.count]);

  function close(go: boolean) {
    try {
      window.localStorage.setItem(key, new Date().toISOString());
    } catch {
      /* not remembered */
    }
    setOpen(false);
    if (go) router.push("/alerts");
  }

  if (!open) return null;
  return (
    <Modal
      title="🔔 تذكير الدفعات الشهرية"
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn primary" onClick={() => close(true)}>
            عرض العملاء المتأخرين
          </button>
          <button className="btn" onClick={() => close(false)}>
            لاحقاً
          </button>
        </>
      }
    >
      <div className="alarm">
        <div className="alarm-n">{summary.count}</div>
        <div>
          <b>عميل لم يدفع دفعة شهر {summary.period}</b>
          <p className="sub">
            {`التنبيه مضبوط على يوم ${summary.alert_day} من كل شهر. إجمالي أرصدتهم ${Number(summary.total_balance).toLocaleString("en-US")} $ — ذُكّر منهم ${summary.reminded_count}.`}
          </p>
        </div>
      </div>
    </Modal>
  );
}
