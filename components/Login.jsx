import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { APP_VERSION } from "@/lib/version";
import { PasswordInput } from "@/components/shared";
import { redeemInviteCode } from "@/lib/invites";

// Auth gate shown by components/App.jsx whenever there's no active session (and, in recoveryMode,
// even with one — App renders this to let the user set a new password after a reset-email link).
// On success, App.jsx's onAuthStateChange listener picks up the new session and swaps this out.
//
// Views: "landing" (Log in / Sign up buttons) · "signin" · "signup" · "reset" (send reset email)
// · "update" (set a new password — recoveryMode).
export function Login({ recoveryMode = false, onDone }) {
  const [view, setView] = useState(recoveryMode ? "update" : "landing");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // A shared invite link looks like studyos.app/?invite=CODE — pick that up on first load and
  // jump straight to Sign up with the code pre-filled, so following a friend's link is one click,
  // not "figure out where to type this."
  useEffect(() => {
    if (typeof window === "undefined") return;
    const code = new URLSearchParams(window.location.search).get("invite");
    if (code) { setInviteCode(code); if (!recoveryMode) setView("signup"); }
  }, []); // eslint-disable-line

  const go = v => { setView(v); setError(""); setNotice(""); setPassword(""); setPassword2(""); setAgreedToTerms(false); };

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
    if (!fullName.trim()) throw new Error("Full name is required.");
    if (!phone.trim()) throw new Error("Mobile phone is required.");
    if (!email || !password) throw new Error("Email and password are both required.");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    if (!inviteCode.trim()) throw new Error("An invite code is required to sign up.");
    // Belt-and-suspenders: the button itself is disabled until checked, but re-check here too
    // (a submit via Enter bypasses a disabled-button click, and this is the one flow it's worth
    // being paranoid about — no account should be created without recorded consent).
    if (!agreedToTerms) throw new Error("You must agree to the Terms of Service and Privacy Policy to create an account.");
    // Redeemed BEFORE the account exists — signUp() has no service-role fallback to delete a
    // just-created account if the code turns out invalid, so validating first is the only way to
    // avoid leaving an orphaned auth user behind on a bad code.
    const ok = await redeemInviteCode(inviteCode.trim());
    if (!ok) throw new Error("That invite code isn't valid (or has been used up). Double-check it or ask whoever invited you for a fresh one.");
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName.trim(), phone: phone.trim(), tos_agreed_at: new Date().toISOString() } },
    });
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
    signin: "Log in to your account",
    signup: "Create your account",
    reset: "Reset your password",
    update: "Set a new password",
  }[view];

  // The heading lives INSIDE the card as its title — the card itself stays put between the
  // "log in" and "sign up" states, only its title and fields change.
  const cardTitle = (
    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--t1)", marginBottom: 18, letterSpacing: "-0.01em" }}>
      {heading}
    </div>
  );
  // Depth the auth card visually off the background it sits on — the base .card class alone
  // (shared with every card app-wide) reads flat here since there's no surrounding page chrome to
  // separate it from. Applied as inline style (not a new global class) so this stays scoped to
  // just the auth forms.
  const authCardStyle = { border: "1px solid var(--b1)", boxShadow: "0 24px 60px rgba(0,0,0,0.45)" };

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
  const switchRow = (prompt, to, label) => (
    <div style={{
      display: "flex", justifyContent: "center", alignItems: "center", gap: 6,
      marginTop: 18, fontSize: 13, color: "var(--t3)",
    }}>
      <span>{prompt}</span>
      <button className="link-btn" type="button" onClick={() => go(to)} style={{ fontWeight: 600 }}>{label}</button>
    </div>
  );

  const FEATURES = [
    { icon: "ti-file-upload", title: "Upload your syllabus", body: "Assignments, exams, and grading weights get pulled out automatically — no manual typing." },
    { icon: "ti-calendar-time", title: "A plan built for you", body: "Study time scheduled around your real class hours, prioritized by what's due soonest and weighted heaviest." },
    { icon: "ti-search", title: "Real difficulty research", body: "A course's difficulty comes from an actual web search — reviews, workload discussion — not a guess. Always yours to override." },
    { icon: "ti-flame", title: "Daily check-ins", body: "Track what got done, build a streak, and see your habits improve over the term." },
  ];

  return (
    <div style={{
      minHeight: "100vh", color: "var(--t1)",
      // Two soft brand-colored glows (matching the wordmark's blue→teal gradient) fading into the
      // base background — the flat single-tone page this replaced had nothing separating the card
      // from its surroundings.
      background: "radial-gradient(ellipse 900px 560px at 18% -8%, rgba(94,163,224,0.16), transparent 60%), "
        + "radial-gradient(ellipse 900px 560px at 82% -8%, rgba(94,224,197,0.12), transparent 60%), var(--bg)",
      fontFamily: "'Inter',sans-serif", display: "flex", alignItems: "flex-start",
      justifyContent: "center", padding: 20,
      paddingTop: "clamp(48px, 12vh, 130px)",
    }}>
      <div style={{ width: "100%", maxWidth: view === "landing" ? 720 : 380 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span onClick={!recoveryMode && view !== "landing" ? () => go("landing") : undefined} style={{
            fontFamily: "'Syne',sans-serif", fontSize: 28, fontWeight: 700,
            background: "linear-gradient(120deg,var(--blue),var(--teal))",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            cursor: !recoveryMode && view !== "landing" ? "pointer" : "default",
          }}>StudyOS</span>
          <div style={{ marginTop: 10, lineHeight: 1.4 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--t1)" }}>
              Get things done, on time
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--t1)" }}>
              A personal assistant for students
            </div>
          </div>
        </div>

        {view === "landing" && (
          <div style={{ maxWidth: 380, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => go("signin")}>Log in</button>
              <button className="btn btn-action" style={{ flex: 1 }} onClick={() => go("signup")}>Sign up</button>
            </div>
          </div>
        )}
        {view === "landing" && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: 14, marginBottom: 28,
          }}>
            {FEATURES.map(f => (
              <div key={f.title} className="card" style={{ marginBottom: 0 }}>
                <i className={`ti ${f.icon}`} style={{ fontSize: 22, color: "var(--amber)", marginBottom: 10, display: "block" }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--t1)", marginBottom: 5 }}>{f.title}</div>
                <div style={{ fontSize: 13, color: "var(--t3)", lineHeight: 1.5 }}>{f.body}</div>
              </div>
            ))}
          </div>
        )}
        {view === "landing" && (
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--t3)" }}>
            <a href="/terms" style={{ color: "var(--t3)" }}>Terms of Service</a>
            {" · "}
            <a href="/privacy" style={{ color: "var(--t3)" }}>Privacy Policy</a>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: "var(--red)", background: "var(--red-bg)", borderRadius: 8, padding: "8px 11px", marginBottom: 12 }}>{error}</div>
        )}
        {notice && (
          <div style={{ fontSize: 13, color: "var(--green)", background: "var(--green-bg)", borderRadius: 8, padding: "8px 11px", marginBottom: 12 }}>{notice}</div>
        )}

        {view === "signin" && (
          <>
            <form onSubmit={signIn} className="card" style={authCardStyle}>
              {cardTitle}
              {emailField}
              <div style={{ marginBottom: 8 }}>
                <label>Password</label>
                <PasswordInput value={password} autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)} />
              </div>
              <div style={{ textAlign: "right", marginBottom: 16 }}>
                <button className="link-btn" type="button" onClick={() => go("reset")}>
                  Forgot your password?
                </button>
              </div>
              <button className="btn btn-action" style={{ width: "100%" }} disabled={busy}>
                {busy ? "Working…" : "Log in"}
              </button>
            </form>
            {switchRow("Don't have an account?", "signup", "Sign up")}
          </>
        )}

        {view === "signup" && (
          <>
            <form onSubmit={signUp} className="card" style={authCardStyle}>
              {cardTitle}
              <div style={{ marginBottom: 12 }}>
                <label>Full name</label>
                <input type="text" value={fullName} autoComplete="name"
                  onChange={e => setFullName(e.target.value)} placeholder="Jane Student" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Mobile phone</label>
                <input type="tel" value={phone} autoComplete="tel"
                  onChange={e => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
              </div>
              {emailField}
              <div style={{ marginBottom: 12 }}>
                <label>Password</label>
                <PasswordInput value={password} autoComplete="new-password"
                  onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label>Invite code</label>
                <input type="text" value={inviteCode} autoCapitalize="characters"
                  onChange={e => setInviteCode(e.target.value)} placeholder="From whoever invited you" />
              </div>
              <div onClick={() => setAgreedToTerms(a => !a)} style={{
                display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, cursor: "pointer",
              }}>
                <div className={`chk${agreedToTerms ? " on" : ""}`} style={{ marginTop: 1 }}>
                  {agreedToTerms && <i className="ti ti-check" style={{ fontSize: 12, color: "var(--green)" }} />}
                </div>
                <span style={{ fontSize: 13, color: "var(--t2)", lineHeight: 1.5 }}>
                  I agree to the{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--blue)" }}>Terms of Service</a>
                  {" "}and{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--blue)" }}>Privacy Policy</a>
                </span>
              </div>
              <button className="btn btn-action" style={{ width: "100%" }} disabled={busy || !agreedToTerms}>
                {busy ? "Working…" : "Create account"}
              </button>
            </form>
            {switchRow("Already have an account?", "signin", "Log in")}
          </>
        )}

        {view === "reset" && (
          <>
            <form onSubmit={sendReset} className="card" style={authCardStyle}>
              {cardTitle}
              {emailField}
              <button className="btn btn-action" style={{ width: "100%" }} disabled={busy}>
                {busy ? "Working…" : "Send reset link"}
              </button>
            </form>
            {switchRow("Remembered it?", "signin", "Back to log in")}
          </>
        )}

        {view === "update" && (
          <form onSubmit={updatePassword} className="card" style={authCardStyle}>
            {cardTitle}
            <div style={{ marginBottom: 12 }}>
              <label>New password</label>
              <PasswordInput value={password} autoComplete="new-password"
                onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>Confirm new password</label>
              <PasswordInput value={password2} autoComplete="new-password"
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
