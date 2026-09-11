export const metadata = { title: "Privacy Policy — StudyOS" };

const S = { marginBottom: 28 };
const H = { fontSize: 18, fontWeight: 600, color: "var(--t1)", marginBottom: 10 };
const P = { fontSize: 14, lineHeight: 1.7, color: "var(--t2)" };
const UL = { fontSize: 14, lineHeight: 1.9, color: "var(--t2)", paddingLeft: 20, margin: 0 };

export default function Privacy() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--t1)", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 20px 80px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 6,
          background: "linear-gradient(120deg,var(--blue),var(--teal))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          StudyOS
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
        <p style={{ fontSize: 13, color: "var(--t3)", marginBottom: 32 }}>Last updated September 2026</p>

        <div style={S}>
          <div style={H}>What we collect</div>
          <ul style={UL}>
            <li>Account info: name, email, phone number</li>
            <li>Academic data you provide or upload: courses, assignments, exams, grades, syllabi/schedule PDFs</li>
            <li>Preferences: study habits, schedule, notification settings</li>
          </ul>
        </div>

        <div style={S}>
          <div style={H}>How it's used</div>
          <p style={P}>
            Solely to run the app for you: building your study plan, showing your schedule, and
            sending the reminders you've opted into. Your data is never sold, and never used for
            advertising.
          </p>
        </div>

        <div style={S}>
          <div style={H}>Phone number &amp; SMS</div>
          <p style={P}>
            Your phone number is used only to send the SMS reminders you've explicitly opted into
            in Preferences, and only while that setting is on. It's sent to our SMS provider
            (Twilio) solely to deliver those messages, and to no one else. Reply STOP to any text
            to opt out immediately, or turn SMS reminders off in Preferences — either way, we stop
            texting you.
          </p>
        </div>

        <div style={S}>
          <div style={H}>Who else sees your data</div>
          <p style={P}>Service providers that make the app work, each only for their specific purpose:</p>
          <ul style={UL}>
            <li><strong>Supabase</strong> — hosts your account and data (row-level security scopes every record to you alone)</li>
            <li><strong>Twilio</strong> — delivers SMS reminders you opt into</li>
            <li><strong>Resend</strong> — delivers account emails (password reset, confirmation)</li>
            <li><strong>Anthropic</strong> — powers AI features like syllabus extraction; only the text needed for that specific request is sent, never your full account</li>
          </ul>
          <p style={{ ...P, marginTop: 10 }}>None of them use your data for their own purposes beyond providing that service to us.</p>
        </div>

        <div style={S}>
          <div style={H}>Your control</div>
          <p style={P}>
            Edit or delete your academic data any time in Preferences. Turn SMS or email reminders
            off any time. Ask to have your account and all associated data deleted entirely.
          </p>
        </div>

        <div style={S}>
          <div style={H}>Contact</div>
          <p style={P}>Questions about this policy or your data: reach the app's operator directly.</p>
        </div>

        <a href="/" style={{ fontSize: 13, color: "var(--blue)" }}>← Back to StudyOS</a>
      </div>
    </div>
  );
}
