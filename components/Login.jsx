import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { APP_VERSION } from "@/lib/version";

// Auth gate shown by components/App.jsx whenever there's no active session (and, in recoveryMode,
// even with one — App renders this to let the user set a new password after a reset-email link).
// On success, App.jsx's onAuthStateChange listener picks up the new session and swaps this out.
//
// Views: "landing" (Log in / Sign up buttons) · "signin" · "signup" · "reset" (send reset email)
// · "update" (set a new password — recoveryMode).
export function Login({ recoveryMode = false, onDone }) {
  const [view, setView] = useState(recoveryMode ? "update" : "landing");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const go = v => { setView(v); setError(""); setNotice(""); setPassword(""); setPassword2(""); };

  async function run(fn) {
    setError(""); setNotice(""); setBusy(true);
    try { await fn(); }
    catch (err) { setError(err?.message || "Something went wrong. Try again."); }
    setBusy(false);
  }

  const signIn = e => { e.preventDefault(); run(async () => {
    if (!email || !password) throw new Error("Email and password are both required.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error; // success → App.jsx's auth listener takes over
  }); };

  const signUp = e => { e.preventDefault(); run(async () => {
    if (!email || !password) throw new Error("Email and password are both required.");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.session) { setNotice("Account created. Check your email for a confirmation link, then log in."); setView("signin"); }
  }); };

  const sendReset = e => { e.preventDefault(); run(async () => {
    if (!email) throw new Error("Enter your email first.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    });
    if (error) throw error;
    setNotice("If an account exists for that email, a reset link is on its way. Check your inbox.");
  }); };

  const updatePassword = e => { e.preventDefault(); run(async () => {
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    if (password !== password2) throw new Error("The two passwords don't match.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    onDone?.(); // recovery session is already active → App renders the app
  }); };

  const heading = {
    landing: "Your study term, planned.",
    signin: "Log in to your account",
    signup: "Create your account",
    reset: "Reset your password",
    update: "Set a new password",
  }[view];

  // NB: field markup is written inline in each view rather than via a helper component — a
  // component defined inside Login() gets a fresh identity every render, which would remount the
  // <input> on each keystroke and drop focus.
  const emailField = (
    <div style={{ marginBottom: 12 }}>
      <label>Email</label>
      <input type="email" value={email} autoComplete="email"
        onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
    </div>
  );
  const backTo = (to, label) => (
    <div style={{ textAlign: "center" }}>
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => go(to)} style={{ marginTop: 6 }}>
        {label}
      </button>
    </div>
  );

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)", color: "var(--t1)",
      fontFamily: "'Inter',sans-serif", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <span style={{
            fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 700,
            background: "linear-gradient(120deg,var(--blue),var(--teal))",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>StudyOS</span>
          <div style={{ fontSize: 13, color: "var(--t3)", marginTop: 4 }}>{heading}</div>
        </div>

        {error && (
          <div style={{ fontSize: 13, color: "var(--red)", background: "var(--red-bg)", borderRadius: 8, padding: "8px 11px", marginBottom: 12 }}>{error}</div>
        )}
        {notice && (
          <div style={{ fontSize: 13, color: "var(--green)", background: "var(--green-bg)", borderRadius: 8, padding: "8px 11px", marginBottom: 12 }}>{notice}</div>
        )}

        {view === "landing" && (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="btn btn-action" style={{ width: "100%" }} onClick={() => go("signin")}>Log in</button>
            <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => go("signup")}>Sign up</button>
          </div>
        )}

        {view === "signin" && (
          <form onSubmit={signIn} className="card">
            {emailField}
            <div style={{ marginBottom: 12 }}>
              <label>Password</label>
              <input type="password" value={password} autoComplete="current-password"
                onChange={e => setPassword(e.target.value)} />
            </div>
            <button className="btn btn-action" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Working…" : "Log in"}
            </button>
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => go("reset")}>
                Forgot your password?
              </button>
            </div>
            {backTo("landing", "← Back")}
          </form>
        )}

        {view === "signup" && (
          <form onSubmit={signUp} className="card">
            {emailField}
            <div style={{ marginBottom: 12 }}>
              <label>Password</label>
              <input type="password" value={password} autoComplete="new-password"
                onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <button className="btn btn-action" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Working…" : "Create account"}
            </button>
            {backTo("landing", "← Back")}
          </form>
        )}

        {view === "reset" && (
          <form onSubmit={sendReset} className="card">
            {emailField}
            <button className="btn btn-action" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Working…" : "Send reset link"}
            </button>
            {backTo("signin", "← Back to log in")}
          </form>
        )}

        {view === "update" && (
          <form onSubmit={updatePassword} className="card">
            <div style={{ marginBottom: 12 }}>
              <label>New password</label>
              <input type="password" value={password} autoComplete="new-password"
                onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>Confirm new password</label>
              <input type="password" value={password2} autoComplete="new-password"
                onChange={e => setPassword2(e.target.value)} />
            </div>
            <button className="btn btn-action" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Working…" : "Update password"}
            </button>
          </form>
        )}

        <div style={{ textAlign: "center", marginTop: 22, fontSize: 11, color: "var(--t3)" }}>
          v{APP_VERSION}
        </div>
      </div>
    </div>
  );
}
