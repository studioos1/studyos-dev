import { useState, useEffect, Fragment } from "react";
import { supabase } from "@/lib/supabase";
import { APP_VERSION } from "@/lib/version";
import { PasswordInput } from "@/components/shared";
import { redeemInviteCode } from "@/lib/invites";

// Hand-drawn-style connector between the landing page's flow cards — a wobbly curve (not a
// straight line) plus an open chevron head, rather than a crisp geometric arrow, to read as
// "sketched," not "generated." Purely decorative (aria-hidden), so a plain module-scope function
// is fine — no props that change per keystroke, nothing that needs remount-safety.
function SketchArrow({ className }) {
  return (
    <svg className={className} width="46" height="24" viewBox="0 0 46 24" fill="none" aria-hidden="true">
      <path d="M3,15 Q14,4 24,13 Q30,18 37,12" stroke="var(--t3)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M31,6 Q41,12 31,18" stroke="var(--t3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
    { icon: "ti-file-upload", title: "Upload Your Syllabus", body: "Assignments, exams, and grading weights get pulled out automatically — no manual typing." },
    { icon: "ti-search", title: "We Classify Difficulties", body: "A course's difficulty comes from an actual web search — reviews, workload discussion — not a guess. Always yours to override." },
    { icon: "ti-calendar-time", title: "We Build Your Study Plan", body: "Study time scheduled around your real class hours, prioritized by what's due soonest and weighted heaviest." },
    { icon: "ti-flame", title: "We Assist You Daily to Track the Plan", body: "Track what got done, build a streak, and see your habits improve over the term." },
  ];

  // A small, honest preview of the real Today tab's Deadline Awareness list — same structure
  // (colored course dot, due-in-N badge, planned checkmark) as the actual product, with made-up
  // example content. Showing this instead of another row of icon-and-caption cards is the whole
  // point of the redesign: prove the product does something concrete rather than describe it.
  const PREVIEW_ROWS = [
    { dot: "#7ab4cc", title: "Lab 4", course: "DSC 10", due: "3d", amber: false },
    { dot: "#c8a860", title: "Midterm", course: "MATH 180A", due: "in 6 days", amber: true },
    { dot: "#9080c0", title: "Essay 1", course: "MMW 122", due: "6d", amber: false },
  ];

  if (view === "landing") return (
    <div style={{
      minHeight: "100vh", color: "var(--t1)",
      background: "radial-gradient(ellipse 900px 560px at 15% -10%, rgba(94,163,224,0.14), transparent 60%), "
        + "radial-gradient(ellipse 900px 560px at 85% 10%, rgba(94,224,197,0.10), transparent 60%), var(--bg)",
      fontFamily: "'Inter',sans-serif",
    }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "36px 24px 64px" }}>
        <span style={{
          fontFamily: "'Syne',sans-serif", fontSize: 19, fontWeight: 700,
          background: "linear-gradient(120deg,var(--blue),var(--teal))",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>StudyOS</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.06em", marginLeft: 6, verticalAlign: "middle" }}>BETA</span>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))",
          gap: 48, alignItems: "center", margin: "44px 0 60px",
        }}>
          <div>
            <h1 style={{
              fontFamily: "'Syne',sans-serif", fontSize: "clamp(23px, 2.5vw, 30px)", fontWeight: 700,
              lineHeight: 1.2, color: "var(--t1)", textWrap: "balance", marginBottom: 14,
            }}>
              Your Personal Study Assistant
            </h1>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--amber)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.35, marginBottom: 18 }}>
              From Syllabus to a Complete Study Plan
            </div>
            <p style={{ fontSize: 16, color: "var(--t2)", lineHeight: 1.65, marginBottom: 28, maxWidth: 420 }}>
              Upload your syllabus. StudyOS understands your courses, plans your study time for the semester, and helps you stay on track every day.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <button className="btn btn-action" style={{ padding: "13px 26px", fontSize: 15 }} onClick={() => go("signup")}>Get Started</button>
              <button className="link-btn" style={{ fontSize: 14 }} onClick={() => go("signin")}>Already have an account? Log in</button>
            </div>
          </div>

          <div className="feature-card" style={{ padding: "22px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "var(--t3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Deadline awareness</span>
              <span className="badge badge-blue" style={{ fontSize: 11 }}>Fall 2026</span>
            </div>
            {PREVIEW_ROWS.map((r, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "11px 0",
                borderBottom: i < PREVIEW_ROWS.length - 1 ? "1px solid var(--b1)" : "none",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.dot, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 13.5, color: "var(--t1)", minWidth: 0 }}>
                  {r.title} <span style={{ color: "var(--t3)" }}>— {r.course}</span>
                </div>
                <span className={`badge ${r.amber ? "badge-amber" : "badge-blue"}`} style={{ fontSize: 11, flexShrink: 0 }}>{r.due}</span>
                <span style={{ fontSize: 11, color: "var(--green)", flexShrink: 0 }}>✓ planned</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--b1)" }}>
              <i className="ti ti-flame" style={{ color: "var(--amber)", fontSize: 15 }} />
              <span style={{ fontSize: 12.5, color: "var(--t2)" }}>7-day study streak</span>
            </div>
          </div>
        </div>

        <div className="feature-flow">
          {FEATURES.map((f, i) => (
            <Fragment key={f.title}>
              <div className="feature-card feature-card-sm">
                <div className="feature-icon feature-icon-sm"><i className={`ti ${f.icon}`} /></div>
                <div className="feature-card-title">{f.title}</div>
                <div className="feature-card-body">{f.body}</div>
              </div>
              {i < FEATURES.length - 1 && <SketchArrow className="feature-arrow" />}
            </Fragment>
          ))}
        </div>

        <div style={{ textAlign: "center", fontSize: 12, color: "var(--t3)" }}>
          <a href="/terms" style={{ color: "var(--t3)" }}>Terms of Service</a>
          {" · "}
          <a href="/privacy" style={{ color: "var(--t3)" }}>Privacy Policy</a>
          <div style={{ marginTop: 8 }}>v{APP_VERSION}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{
      minHeight: "100vh", color: "var(--t1)",
      background: "radial-gradient(ellipse 900px 560px at 18% -8%, rgba(94,163,224,0.16), transparent 60%), "
        + "radial-gradient(ellipse 900px 560px at 82% -8%, rgba(94,224,197,0.12), transparent 60%), var(--bg)",
      fontFamily: "'Inter',sans-serif", display: "flex", alignItems: "flex-start",
      justifyContent: "center", padding: 20,
      paddingTop: "clamp(48px, 12vh, 130px)",
    }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span onClick={!recoveryMode ? () => go("landing") : undefined} style={{
            fontFamily: "'Syne',sans-serif", fontSize: 28, fontWeight: 700,
            background: "linear-gradient(120deg,var(--blue),var(--teal))",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            cursor: !recoveryMode ? "pointer" : "default",
          }}>StudyOS</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.06em", marginLeft: 7, verticalAlign: "middle" }}>BETA</span>
          <div style={{ marginTop: 10, lineHeight: 1.4 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--t1)" }}>
              Get things done, on time
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--t1)" }}>
              A personal assistant for students
            </div>
          </div>
        </div>

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
                  {" "}and acknowledge the{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--blue)" }}>Privacy Policy</a>
                  .
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
