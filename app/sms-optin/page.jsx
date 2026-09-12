export const metadata = { title: "SMS Opt-In — StudyOS" };

const H = { fontSize: 18, fontWeight: 600, color: "var(--t1)", marginBottom: 10 };
const P = { fontSize: 14, lineHeight: 1.7, color: "var(--t2)" };

// Public, unauthenticated evidence page for A2P 10DLC campaign verification. The real opt-in
// screen lives inside the app behind a login wall, so carriers/TCR can't crawl it directly — this
// page documents the exact flow in text and shows a screenshot of the live screen, hosted on the
// same domain as the Terms/Privacy pages it links to (more verifiable than a third-party file link).
export default function SmsOptIn() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--t1)", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 20px 80px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 6,
          background: "linear-gradient(120deg,var(--blue),var(--teal))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          StudyOS
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>SMS Opt-In</h1>
        <p style={{ fontSize: 13, color: "var(--t3)", marginBottom: 32 }}>How consumers consent to receive text messages from StudyOS</p>

        <div style={{ marginBottom: 28 }}>
          <div style={H}>The flow</div>
          <p style={P}>
            StudyOS is a web application (<a href="https://www.studyos.io" style={{ color: "var(--blue)" }}>studyos.io</a>) that
            students log into with their own account. A logged-in user opts in to SMS reminders from
            their account's <strong>Preferences → Notifications → SMS Reminders</strong> screen by:
          </p>
          <ol style={{ ...P, paddingLeft: 20, marginTop: 10 }}>
            <li>Entering their phone number.</li>
            <li>Reading the message-type, frequency, rate-disclosure, and STOP/HELP text shown on that screen.</li>
            <li>Checking a consent checkbox — unchecked by default — reading: <em>"I agree to receive SMS text messages from StudyOS at the number above."</em></li>
            <li>Clicking <strong>"Yes, text me reminders"</strong> to submit.</li>
          </ol>
          <p style={{ ...P, marginTop: 10 }}>
            This screen requires an account and login, so it isn't independently crawlable — the
            screenshot below shows the exact, live screen from a real account.
          </p>
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={H}>Screenshot of the live opt-in screen</div>
          <img src="/sms-optin-screenshot.png" alt="StudyOS SMS Reminders opt-in screen, showing the phone number field, message frequency and rate disclosure, STOP/HELP instructions, Terms of Service and Privacy Policy links, a checked consent checkbox, and the Yes, text me reminders button."
            style={{ width: "100%", borderRadius: 10, border: "1px solid var(--b1)", display: "block" }} />
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={H}>Related pages</div>
          <p style={P}>
            <a href="/terms" style={{ color: "var(--blue)" }}>Terms of Service</a>
            {" · "}
            <a href="/privacy" style={{ color: "var(--blue)" }}>Privacy Policy</a>
          </p>
        </div>

        <a href="/" style={{ fontSize: 13, color: "var(--blue)" }}>← Back to StudyOS</a>
      </div>
    </div>
  );
}
