export const metadata = { title: "Terms of Service — StudyOS" };

const S = { marginBottom: 26 };
const H = { fontSize: 17, fontWeight: 600, color: "var(--t1)", marginBottom: 10 };
const P = { fontSize: 14, lineHeight: 1.7, color: "var(--t2)" };
const UL = { fontSize: 14, lineHeight: 1.85, color: "var(--t2)", paddingLeft: 20, margin: 0 };
const CAPS = { fontSize: 13.5, lineHeight: 1.75, color: "var(--t2)", fontWeight: 600 };

export default function Terms() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--t1)", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px 80px" }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700,
            background: "linear-gradient(120deg,var(--blue),var(--teal))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            StudyOS
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.06em", marginLeft: 7, verticalAlign: "middle" }}>BETA</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Terms &amp; Conditions</h1>
        <p style={{ fontSize: 13, color: "var(--t3)", marginBottom: 8 }}>Effective Date: September 13, 2026</p>
        <p style={{ fontSize: 13, color: "var(--t3)", marginBottom: 32 }}>Last Updated: September 13, 2026</p>

        <p style={{ ...P, marginBottom: 16 }}>Welcome to StudyOS.</p>
        <p style={{ ...P, marginBottom: 16 }}>
          These Terms &amp; Conditions ("Terms") govern your access to and use of the StudyOS
          website, applications, AI-assisted study planning features, and related services
          (collectively, the "Service").
        </p>
        <p style={{ ...P, marginBottom: 16 }}>StudyOS is operated by <strong>StudyOS</strong> ("StudyOS," "we," "us," or "our").</p>
        <p style={{ ...P, marginBottom: 32 }}>By creating an account or using StudyOS, you agree to these Terms. If you do not agree, do not use the Service.</p>

        <div style={S}>
          <div style={H}>1. About StudyOS</div>
          <p style={P}>StudyOS is a personal study assistant designed to help students plan and manage their studies.</p>
          <p style={P}>
            The Service may allow you to upload or enter syllabi, courses, assignments, exams,
            deadlines, schedules, study preferences, availability, and other academic
            information.
          </p>
          <p style={P}>
            StudyOS uses artificial intelligence and other automated technologies to analyze this
            information, research or estimate course workload and difficulty, create
            personalized study plans, allocate study time across a quarter or semester, and help
            you track your progress.
          </p>
        </div>

        <div style={S}>
          <div style={H}>2. Beta Service</div>
          <p style={P}>StudyOS is currently provided as a <strong>Beta service</strong> and is under active development.</p>
          <p style={P}>Beta software may contain errors, incomplete functionality, inaccurate information, interruptions, or other problems.</p>
          <p style={P}>
            Features may be added, changed, limited, suspended, or removed at any time. Study
            plans, workload estimates, course information, recommendations, and other outputs may
            also change as the Service develops.
          </p>
          <p style={P}>You understand that you are using an experimental service and should not rely on StudyOS as your sole source of academic information.</p>
        </div>

        <div style={S}>
          <div style={H}>3. AI and Automated Planning</div>
          <p style={P}>StudyOS uses artificial intelligence and automated systems to analyze information and generate study plans, workload estimates, schedules, recommendations, and other content.</p>
          <p style={P}>These systems can make mistakes. For example, StudyOS may:</p>
          <ul style={UL}>
            <li>incorrectly interpret a syllabus;</li>
            <li>miss or incorrectly identify a deadline;</li>
            <li>misunderstand an assignment or exam requirement;</li>
            <li>incorrectly estimate course difficulty or workload;</li>
            <li>allocate too much or too little study time;</li>
            <li>generate incomplete or inaccurate information; or</li>
            <li>fail to reflect changes made by an instructor or educational institution.</li>
          </ul>
          <p style={{ ...P, marginTop: 10 }}>
            You should verify important academic information against official sources, including
            your syllabus, learning management system, instructor communications, university
            systems, and other official academic materials.
          </p>
        </div>

        <div style={S}>
          <div style={H}>4. Your Academic Responsibility</div>
          <p style={P}><strong>StudyOS is a planning and organizational tool. You remain responsible for your academic decisions and obligations.</strong></p>
          <p style={P}>You are responsible for verifying your courses, assignments, examinations, deadlines, academic requirements, and other obligations with your instructors and educational institution.</p>
          <p style={P}>StudyOS does not replace your instructor, academic advisor, educational institution, or other qualified academic professional.</p>
        </div>

        <div style={S}>
          <div style={H}>5. No Guarantee of Academic Results</div>
          <p style={P}>StudyOS is intended to help you organize and plan your studies. We do not guarantee any particular academic result.</p>
          <p style={P}>Use of StudyOS does not guarantee that you will:</p>
          <ul style={UL}>
            <li>receive a particular grade;</li>
            <li>complete an assignment on time;</li>
            <li>pass an examination or course;</li>
            <li>receive sufficient study time;</li>
            <li>improve your academic performance;</li>
            <li>complete a degree or academic program; or</li>
            <li>achieve any other educational outcome.</li>
          </ul>
          <p style={{ ...P, marginTop: 10 }}>Academic performance depends on many factors outside StudyOS's control.</p>
        </div>

        <div style={S}>
          <div style={H}>6. Eligibility and Age</div>
          <p style={P}>StudyOS is not intended for children under 13. You may not create or use a StudyOS account if you are under 13.</p>
          <p style={P}>If you are not old enough under applicable law to enter into these Terms independently, you may use StudyOS only with the permission of a parent or legal guardian.</p>
        </div>

        <div style={S}>
          <div style={H}>7. Your Account</div>
          <p style={P}>You agree to provide accurate information when creating and maintaining your account.</p>
          <p style={P}>You are responsible for protecting your login credentials and for activity occurring through your account.</p>
          <p style={P}>Please contact us at <strong>support@studyos.io</strong> if you believe your account has been accessed without authorization.</p>
        </div>

        <div style={S}>
          <div style={H}>8. Your Content</div>
          <p style={P}>"Your Content" includes syllabi, schedules, course materials, assignments, notes, preferences, documents, and other information you provide to StudyOS.</p>
          <p style={P}>You retain ownership of Your Content.</p>
          <p style={P}>You grant StudyOS permission to host, store, process, reproduce, and analyze Your Content as reasonably necessary to provide, maintain, secure, and improve the Service.</p>
          <p style={P}>You represent that you have the right to provide the content you upload to StudyOS.</p>
          <p style={P}>Do not upload sensitive personal information that is unnecessary for study planning.</p>
          <p style={P}>Our handling of personal information is explained in our <a href="/privacy" style={{ color: "var(--blue)" }}>Privacy Policy</a>.</p>
        </div>

        <div style={S}>
          <div style={H}>9. Course Materials and Copyright</div>
          <p style={P}>Syllabi and other educational materials may belong to instructors, universities, publishers, or other third parties.</p>
          <p style={P}>You are responsible for ensuring that you are permitted to upload materials you provide to StudyOS.</p>
          <p style={P}>Uploading material to StudyOS does not transfer ownership of that material to us.</p>
          <p style={P}>You may not use StudyOS to unlawfully copy or distribute copyrighted or proprietary materials.</p>
        </div>

        <div style={S}>
          <div style={H}>10. Academic Integrity</div>
          <p style={P}>StudyOS is intended to help students organize and plan their own academic work.</p>
          <p style={P}>Your educational institution or instructor may have rules regarding artificial intelligence and other external tools. You are responsible for understanding and complying with those rules.</p>
          <p style={P}>StudyOS does not authorize academic dishonesty or any conduct prohibited by your educational institution.</p>
        </div>

        <div style={S}>
          <div style={H}>11. Acceptable Use</div>
          <p style={P}>You may not use StudyOS to:</p>
          <ul style={UL}>
            <li>violate applicable law;</li>
            <li>violate another person's rights;</li>
            <li>facilitate academic dishonesty;</li>
            <li>gain unauthorized access to systems or accounts;</li>
            <li>interfere with the security or operation of StudyOS;</li>
            <li>introduce malicious software;</li>
            <li>impersonate another person;</li>
            <li>scrape or systematically extract StudyOS data without authorization; or</li>
            <li>reverse engineer the Service except where applicable law expressly permits it.</li>
          </ul>
          <p style={{ ...P, marginTop: 10 }}>We may suspend or terminate accounts that misuse the Service.</p>
        </div>

        <div style={S}>
          <div style={H}>12. Third-Party Services</div>
          <p style={P}>StudyOS may use third-party services for functions such as cloud hosting, authentication, artificial intelligence, analytics, communications, and other technology services.</p>
          <p style={P}>Those services may be subject to their own terms and privacy practices.</p>
          <p style={P}>StudyOS is not responsible for third-party products or services outside our reasonable control.</p>
        </div>

        <div style={S}>
          <div style={H}>13. Availability</div>
          <p style={P}>We aim to provide a useful and reliable Service, but we do not guarantee that StudyOS will always be available, uninterrupted, secure, or error-free.</p>
          <p style={P}>StudyOS may be unavailable because of maintenance, technical problems, third-party failures, Beta development, or circumstances outside our control.</p>
        </div>

        <div style={S}>
          <div style={H}>14. Fees</div>
          <p style={P}>Some or all StudyOS features may be provided without charge during the Beta.</p>
          <p style={P}>We may introduce paid services in the future. We will disclose applicable pricing and material payment, renewal, and cancellation terms before charging you.</p>
          <p style={P}>Participation in a free Beta does not by itself authorize StudyOS to charge you for a future paid service.</p>
        </div>

        <div style={S}>
          <div style={H}>15. StudyOS Intellectual Property</div>
          <p style={P}>StudyOS and its software, technology, designs, trademarks, logos, interfaces, and other proprietary materials are owned by StudyOS or its licensors.</p>
          <p style={P}>These Terms give you a limited, personal, non-exclusive, non-transferable, and revocable right to use StudyOS for its intended purpose. They do not transfer ownership of StudyOS technology or intellectual property to you.</p>
        </div>

        <div style={S}>
          <div style={H}>16. Disclaimer of Warranties</div>
          <p style={CAPS}>TO THE MAXIMUM EXTENT PERMITTED BY LAW, STUDYOS IS PROVIDED "AS IS" AND "AS AVAILABLE."</p>
          <p style={{ ...CAPS, marginTop: 10 }}>WE DISCLAIM WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT.</p>
          <p style={{ ...CAPS, marginTop: 10 }}>WE DO NOT WARRANT THAT STUDYOS OR ANY STUDY PLAN, COURSE ANALYSIS, WORKLOAD ESTIMATE, RECOMMENDATION, AI-GENERATED OUTPUT, OR OTHER INFORMATION WILL BE ACCURATE, COMPLETE, RELIABLE, OR ERROR-FREE.</p>
          <p style={{ ...P, marginTop: 10 }}>Some jurisdictions do not permit certain warranty exclusions, so some exclusions may not apply to you.</p>
        </div>

        <div style={S}>
          <div style={H}>17. Limitation of Liability</div>
          <p style={CAPS}>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, STUDYOS AND ITS OWNERS, OFFICERS, EMPLOYEES,
            CONTRACTORS, AFFILIATES, AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING LOSS OF
            DATA, OPPORTUNITIES, ACADEMIC CREDIT, OR OTHER INTANGIBLE LOSSES ARISING FROM OR
            RELATED TO YOUR USE OF STUDYOS.
          </p>
          <p style={{ ...CAPS, marginTop: 10 }}>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, STUDYOS'S TOTAL LIABILITY FOR CLAIMS ARISING
            FROM OR RELATED TO THE SERVICE WILL NOT EXCEED THE GREATER OF:
          </p>
          <p style={{ ...CAPS, marginTop: 10 }}>(A) THE AMOUNT YOU PAID STUDYOS DURING THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM; OR</p>
          <p style={{ ...CAPS, marginTop: 4 }}>(B) US $100.</p>
          <p style={{ ...P, marginTop: 10 }}>Nothing in these Terms excludes or limits liability that cannot legally be excluded or limited.</p>
        </div>

        <div style={S}>
          <div style={H}>18. Indemnification</div>
          <p style={P}>
            To the extent permitted by law, you agree to indemnify and hold harmless StudyOS and
            its affiliates, officers, employees, and contractors from claims, liabilities,
            damages, and reasonable expenses resulting from your unlawful misuse of StudyOS,
            violation of these Terms, or infringement of another person's rights.
          </p>
        </div>

        <div style={S}>
          <div style={H}>19. Termination</div>
          <p style={P}>You may stop using StudyOS at any time.</p>
          <p style={P}>We may suspend or terminate access if you materially violate these Terms, misuse the Service, create a security or legal risk, or if continued operation of the Service is no longer reasonably possible.</p>
          <p style={P}>Because StudyOS is a Beta service, we may also discontinue the Beta or Service.</p>
        </div>

        <div style={S}>
          <div style={H}>20. Changes to These Terms</div>
          <p style={P}>We may update these Terms as StudyOS develops.</p>
          <p style={P}>If we make material changes, we will provide reasonable notice through StudyOS, email, or another appropriate method.</p>
          <p style={P}>Where required by law, we will request your consent to updated Terms.</p>
        </div>

        <div style={S}>
          <div style={H}>21. Governing Law</div>
          <p style={P}>These Terms are governed by the laws of the State of California, except where applicable law requires otherwise.</p>
          <p style={P}>Any dispute that may lawfully be subject to this provision will be brought in the appropriate state or federal courts located in <strong>Santa Clara County, California</strong>.</p>
          <p style={P}>Nothing in these Terms limits consumer rights that cannot legally be waived.</p>
        </div>

        <div style={S}>
          <div style={H}>22. SMS/Text Messaging Program</div>
          <p style={P}>
            If you opt in to StudyOS Reminders, we will send SMS text messages to the phone
            number you provide — a daily summary, overdue-item nudges, exam/project countdowns,
            and any custom reminders you set. <strong>Message frequency varies (up to a few
            messages a day, depending on your settings).</strong>
          </p>
          <p style={P}><strong>Message and data rates may apply.</strong></p>
          <p style={P}>
            Reply <strong>HELP</strong> for help. Reply <strong>STOP</strong> at any time to
            cancel — you will receive no further messages, and you can also turn SMS reminders
            off in Preferences. Opting out of SMS does not affect your account or any other part
            of the Service.
          </p>
          <p style={P}><strong>Carriers are not liable for delayed or undelivered messages.</strong></p>
          <p style={P}>
            See our <a href="/privacy" style={{ color: "var(--blue)" }}>Privacy Policy</a> for
            how your phone number and messaging data are handled.
          </p>
        </div>

        <div style={S}>
          <div style={H}>23. Contact</div>
          <p style={P}>Questions about these Terms may be sent to:</p>
          <p style={{ ...P, marginTop: 8 }}>
            <strong>StudyOS</strong><br />
            California, United States<br />
            Email: support@studyos.io
          </p>
        </div>

        <a href="/" style={{ fontSize: 13, color: "var(--blue)" }}>← Back to StudyOS</a>
      </div>
    </div>
  );
}
