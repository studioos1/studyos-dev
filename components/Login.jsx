import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { APP_VERSION } from "@/lib/version";

// Auth gate shown by components/App.jsx whenever there's no active session. On success, App.jsx's
// onAuthStateChange listener picks up the new session and swaps this out for the app — so there's
// nothing to do here after sign-in beyond letting Supabase set the session.
export function Login() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!email || !password) { setError("Email and password are both required."); return; }
    if (mode === "signup" && password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Success — App.jsx's auth listener takes over from here.
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation is enabled on the project — no session yet.
          setNotice("Account created. Check your email for a confirmation link, then sign in.");
          setMode("signin");
        }
        // If a session came back, App.jsx's listener handles the rest.
      }
    } catch (err) {
      setError(err?.message || "Something went wrong. Try again.");
    }
    setBusy(false);
  }

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
          <div style={{ fontSize: 13, color: "var(--t3)", marginTop: 4 }}>
            {mode === "signin" ? "Sign in to your account" : "Create your account"}
          </div>
        </div>

        <form onSubmit={submit} className="card">
          <div style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input
              type="email" value={email} autoComplete="email"
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label>Password</label>
            <input
              type="password" value={password}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : ""}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 13, color: "var(--red)", background: "var(--red-bg)",
              borderRadius: 8, padding: "8px 11px", marginBottom: 12,
            }}>{error}</div>
          )}
          {notice && (
            <div style={{
              fontSize: 13, color: "var(--green)", background: "var(--green-bg)",
              borderRadius: 8, padding: "8px 11px", marginBottom: 12,
            }}>{notice}</div>
          )}

          <button className="btn btn-action" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 13, color: "var(--t3)" }}>
          {mode === "signin" ? (
            <>New here?{" "}
              <button className="btn btn-ghost btn-sm" type="button"
                onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>
                Create an account
              </button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button className="btn btn-ghost btn-sm" type="button"
                onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>
                Sign in
              </button>
            </>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 22, fontSize: 11, color: "var(--t3)" }}>
          v{APP_VERSION}
        </div>
      </div>
    </div>
  );
}
