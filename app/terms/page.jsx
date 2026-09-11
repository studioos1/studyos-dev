export const metadata = { title: "Terms of Service — StudyOS" };

const S = { marginBottom: 28 };
const H = { fontSize: 18, fontWeight: 600, color: "var(--t1)", marginBottom: 10 };
const P = { fontSize: 14, lineHeight: 1.7, color: "var(--t2)" };

export default function Terms() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--t1)", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 20px 80px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 6,
          background: "linear-gradient(120deg,var(--blue),var(--teal))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          StudyOS
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Terms of Service</h1>
        <p style={{ fontSize: 13, color: "var(--t3)", marginBottom: 32 }}>Last updated September 2026</p>

        <div style={S}>
          <div style={H}>What StudyOS is</div>
          <p style={P}>
            StudyOS is a personal study-planning tool. It reads your class schedule and syllabi,
            builds a study plan, and can remind you about deadlines by email and SMS text message.
            It's built and operated as a small personal project, not a commercial company — treat
            it accordingly: back up anything irreplaceable, and don't rely on it for anything
            critical.
          </p>
        </div>

        <div style={S}>
          <div style={H}>Your account</div>
          <p style={P}>
            You're responsible for the accuracy of what you enter and upload, and for keeping your
            login credentials to yourself. You can delete your academic data at any time from
            Preferences, or ask to have your account removed entirely.
          </p>
        </div>

        <div style={S}>
          <div style={H}>SMS text messaging</div>
          <p style={P}>
            If you opt in to SMS reminders, StudyOS will text the phone number you provide with
            messages you've chosen to receive (a daily summary, overdue-item nudges, exam/project
            countdowns, and any custom reminders you set). Message frequency varies with your
            settings — typically up to a few messages a day. <strong>Message and data rates may
            apply</strong> from your carrier. Reply <strong>STOP</strong> to any message to cancel
            at any time, or turn it off in Preferences. Reply <strong>HELP</strong> for help.
            Opting out of SMS doesn't affect your account or any other part of the app.
          </p>
        </div>

        <div style={S}>
          <div style={H}>No warranty</div>
          <p style={P}>
            StudyOS is provided "as is." Study plans, difficulty estimates, and AI-assisted
            extraction from PDFs can be wrong — always verify due dates and requirements against
            your actual syllabus. It's a planning aid, not a substitute for reading your course
            materials.
          </p>
        </div>

        <div style={S}>
          <div style={H}>Changes</div>
          <p style={P}>
            These terms may be updated as the app evolves. Material changes affecting SMS/email
            consent will be reflected here with an updated date above.
          </p>
        </div>

        <div style={S}>
          <div style={H}>Contact</div>
          <p style={P}>Questions about these terms: reach the app's operator directly.</p>
        </div>

        <a href="/" style={{ fontSize: 13, color: "var(--blue)" }}>← Back to StudyOS</a>
      </div>
    </div>
  );
}
