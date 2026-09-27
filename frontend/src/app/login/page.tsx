"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <div className="brand-mark">
            <span className="sq">
              <i />
              <i />
              <i />
              <i />
            </span>
            إدارة العقارات
          </div>
          <div className="brand-sub">سجّل الدخول للمتابعة</div>
        </div>

        <div className="login-body">
          {error ? (
            <div className="alert err">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="username">اسم المستخدم</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">كلمة المرور</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "جارٍ الدخول…" : "دخول"}
          </button>
        </div>
      </form>
    </div>
  );
}
