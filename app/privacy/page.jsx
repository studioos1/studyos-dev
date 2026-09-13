export const metadata = { title: "Privacy Policy — StudyOS" };

const S = { marginBottom: 26 };
const H = { fontSize: 17, fontWeight: 600, color: "var(--t1)", marginBottom: 10 };
const SH = { fontSize: 14.5, fontWeight: 600, color: "var(--t1)", marginTop: 14, marginBottom: 6 };
const P = { fontSize: 14, lineHeight: 1.7, color: "var(--t2)" };
const UL = { fontSize: 14, lineHeight: 1.85, color: "var(--t2)", paddingLeft: 20, margin: 0 };

export default function Privacy() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--t1)", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 20px 80px" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 6,
          background: "linear-gradient(120deg,var(--blue),var(--teal))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          StudyOS
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
        <p style={{ fontSize: 13, color: "var(--t3)", marginBottom: 8 }}>Effective Date: September 13, 2026</p>
        <p style={{ fontSize: 13, color: "var(--t3)", marginBottom: 32 }}>Last Updated: September 13, 2026</p>

        <p style={{ ...P, marginBottom: 32 }}>
          This Privacy Policy explains how <strong>StudyOS</strong> ("StudyOS," "we," "us," or
          "our") collects, uses, shares, and protects information when you use StudyOS.
        </p>

        <div style={S}>
          <div style={H}>1. Information We Collect</div>

          <div style={SH}>Account Information</div>
          <p style={P}>When you create an account, we may collect information such as:</p>
          <ul style={UL}>
            <li>name;</li>
            <li>email address;</li>
            <li>account credentials or authentication identifiers; and</li>
            <li>account preferences.</li>
          </ul>

          <div style={SH}>Academic and Study Information</div>
          <p style={P}>StudyOS may collect information you provide about your studies, including:</p>
          <ul style={UL}>
            <li>school or university;</li>
            <li>courses;</li>
            <li>syllabi;</li>
            <li>class schedules;</li>
            <li>assignments and projects;</li>
            <li>exams and deadlines;</li>
            <li>course requirements;</li>
            <li>study preferences;</li>
            <li>study availability;</li>
            <li>planned study time;</li>
            <li>completed study activities; and</li>
            <li>study progress.</li>
          </ul>

          <div style={SH}>Uploaded Content</div>
          <p style={P}>
            You may upload syllabi, course documents, and other materials. StudyOS processes
            these materials to identify information such as courses, topics, assignments, exams,
            deadlines, and other information needed to create and maintain your study plan.
          </p>
          <p style={P}>Please avoid uploading personal information that is not necessary for study planning.</p>

          <div style={SH}>Usage and Technical Information</div>
          <p style={P}>When you use StudyOS, we may automatically collect information such as:</p>
          <ul style={UL}>
            <li>features used;</li>
            <li>pages or screens viewed;</li>
            <li>actions performed;</li>
            <li>study-plan activity;</li>
            <li>dates and times of use;</li>
            <li>device and browser information;</li>
            <li>operating system;</li>
            <li>IP address;</li>
            <li>diagnostic information; and</li>
            <li>error and performance logs.</li>
          </ul>

          <div style={SH}>Connected Services</div>
          <p style={P}>
            If you choose to connect StudyOS to another service, such as a calendar,
            authentication provider, educational platform, or learning management system, we may
            receive information that you authorize that service to provide.
          </p>
        </div>

        <div style={S}>
          <div style={H}>2. How We Use Information</div>
          <p style={P}>We may use information to:</p>
          <ul style={UL}>
            <li>create and maintain your account;</li>
            <li>analyze syllabi and course materials;</li>
            <li>identify assignments, exams, and deadlines;</li>
            <li>research and estimate course workload or difficulty;</li>
            <li>estimate appropriate study effort;</li>
            <li>generate personalized study plans;</li>
            <li>schedule regular study, assignments, projects, and exam preparation;</li>
            <li>track progress;</li>
            <li>adjust future study schedules;</li>
            <li>provide AI-assisted features;</li>
            <li>operate and improve StudyOS;</li>
            <li>diagnose technical problems;</li>
            <li>maintain security;</li>
            <li>prevent fraud or misuse;</li>
            <li>communicate with you about StudyOS; and</li>
            <li>comply with legal obligations.</li>
          </ul>
        </div>

        <div style={S}>
          <div style={H}>3. Artificial Intelligence</div>
          <p style={P}>
            StudyOS uses artificial intelligence and automated technologies to provide features
            such as syllabus analysis, course and workload analysis, study-time estimation, and
            personalized study planning.
          </p>
          <p style={P}>
            Information submitted to these features may be processed by technology providers
            that help us provide AI functionality. StudyOS does not permit third-party AI
            providers to use your personal StudyOS content to train their general-purpose AI
            models.
          </p>
          <p style={P}>
            AI-generated information may be inaccurate or incomplete. Please see our Terms &amp;
            Conditions for additional information about AI-generated study plans and
            recommendations.
          </p>
        </div>

        <div style={S}>
          <div style={H}>4. How We Share Information</div>
          <p style={P}><strong>We do not sell your personal information for money.</strong></p>
          <p style={P}>We may share information with service providers that help us operate StudyOS, including providers of:</p>
          <ul style={UL}>
            <li>cloud infrastructure and hosting;</li>
            <li>databases and storage;</li>
            <li>artificial intelligence services;</li>
            <li>authentication;</li>
            <li>analytics;</li>
            <li>email and communications;</li>
            <li>security; and</li>
            <li>customer support.</li>
          </ul>
          <p style={{ ...P, marginTop: 10 }}>
            These providers may process information for purposes related to providing their
            services to StudyOS, subject to applicable agreements and law.
          </p>
          <p style={P}>We may also disclose information:</p>
          <ul style={UL}>
            <li>when required by law or valid legal process;</li>
            <li>when reasonably necessary to protect StudyOS, our users, or others;</li>
            <li>in connection with a merger, acquisition, financing, reorganization, or sale of the business, subject to applicable law; or</li>
            <li>when you direct or authorize us to do so.</li>
          </ul>
        </div>

        <div style={S}>
          <div style={H}>5. Student Data</div>
          <p style={P}>
            We do not sell your syllabi, course information, study history, or other personal
            StudyOS information to data brokers or advertisers for monetary consideration.
          </p>
          <p style={P}>
            StudyOS uses academic information you provide for purposes related to operating and
            improving the StudyOS Service as described in this Policy. StudyOS does not use
            advertising or analytics technology that would constitute "sharing" of personal
            information under the CCPA/CPRA or similar laws.
          </p>
        </div>

        <div style={S}>
          <div style={H}>6. Cookies and Analytics</div>
          <p style={P}>StudyOS may use cookies, local storage, analytics, and similar technologies to:</p>
          <ul style={UL}>
            <li>keep you signed in;</li>
            <li>remember your settings;</li>
            <li>provide StudyOS functionality;</li>
            <li>maintain security;</li>
            <li>understand how StudyOS is used; and</li>
            <li>diagnose and improve performance.</li>
          </ul>
          <p style={{ ...P, marginTop: 10 }}>
            Where required by applicable law, we will obtain consent before using non-essential
            cookies or similar technologies.
          </p>
        </div>

        <div style={S}>
          <div style={H}>7. Data Retention</div>
          <p style={P}>
            We retain personal information for as long as reasonably necessary to provide
            StudyOS, maintain your account, fulfill the purposes described in this Policy,
            comply with legal obligations, resolve disputes, and protect the Service.
          </p>
          <p style={P}>
            When information is no longer reasonably necessary, we may delete or de-identify it.
            If you delete your account, we will delete or de-identify associated personal
            information within a reasonable period, except where retention is required or
            permitted by law.
          </p>
          <p style={P}>
            Information may remain temporarily in secure backups until those backups are
            overwritten through normal retention processes.
          </p>
        </div>

        <div style={S}>
          <div style={H}>8. Your Privacy Rights</div>
          <p style={P}>Depending on where you live, you may have rights regarding your personal information, including rights to:</p>
          <ul style={UL}>
            <li>access your personal information;</li>
            <li>request correction;</li>
            <li>request deletion;</li>
            <li>obtain information about how your information is used or disclosed;</li>
            <li>receive a portable copy of certain information;</li>
            <li>withdraw certain consent; and</li>
            <li>opt out of certain uses or disclosures where applicable.</li>
          </ul>
          <p style={{ ...P, marginTop: 10 }}>
            Privacy requests may be submitted to <strong>privacy@studyos.io</strong>. We may need
            to verify your identity before completing certain requests. We will not discriminate
            against you for exercising rights provided by applicable privacy law.
          </p>
        </div>

        <div style={S}>
          <div style={H}>9. California Privacy Rights</div>
          <p style={P}>
            California residents may have additional rights under California privacy laws.
            Depending on the applicability of those laws to StudyOS, these may include rights to
            know about personal information collected, request deletion, correct inaccurate
            information, obtain information regarding disclosures, and opt out of certain sales
            or sharing of personal information.
          </p>
          <p style={P}>
            StudyOS does not sell personal information for monetary consideration. California
            privacy requests may be submitted to <strong>privacy@studyos.io</strong>.
          </p>
        </div>

        <div style={S}>
          <div style={H}>10. Children's Privacy</div>
          <p style={P}>
            StudyOS is not intended for children under 13. We do not knowingly collect personal
            information from children under 13 without legally required parental consent.
          </p>
          <p style={P}>
            If we learn that we have collected personal information from a child under 13
            contrary to this Policy, we will take appropriate steps to delete it. If you believe
            a child under 13 has provided personal information to StudyOS, please contact{" "}
            <strong>privacy@studyos.io</strong>.
          </p>
        </div>

        <div style={S}>
          <div style={H}>11. Data Security</div>
          <p style={P}>
            We use reasonable administrative, technical, and organizational safeguards designed
            to protect personal information. However, no internet service, electronic
            transmission, or data-storage system can be guaranteed to be completely secure.
          </p>
          <p style={P}>
            You are responsible for protecting your account credentials and should notify us if
            you believe your account has been compromised.
          </p>
        </div>

        <div style={S}>
          <div style={H}>12. Educational Institutions</div>
          <p style={P}>
            StudyOS is currently offered directly to users and is not necessarily acting on
            behalf of your school, college, or university. Your use of StudyOS does not by
            itself make StudyOS part of your educational institution or subject StudyOS to your
            institution's policies.
          </p>
          <p style={P}>
            If StudyOS later provides services directly to educational institutions involving
            education records, additional privacy requirements and agreements may apply.
          </p>
        </div>

        <div style={S}>
          <div style={H}>13. International Users</div>
          <p style={P}>
            StudyOS is operated from the United States. If you use StudyOS outside the United
            States, your information may be transferred to and processed in the United States or
            other countries where StudyOS or its service providers operate. Those countries may
            have privacy laws different from those where you live.
          </p>
        </div>

        <div style={S}>
          <div style={H}>14. Changes to This Privacy Policy</div>
          <p style={P}>
            We may update this Privacy Policy as StudyOS develops. If we make material changes,
            we will provide appropriate notice through StudyOS, email, or another appropriate
            method. Where required by law, we will obtain consent before using personal
            information for materially different purposes.
          </p>
          <p style={P}>The date at the top indicates when this Policy was last updated.</p>
        </div>

        <div style={S}>
          <div style={H}>15. Contact Us</div>
          <p style={P}>For privacy questions or requests, contact:</p>
          <p style={{ ...P, marginTop: 8 }}>
            <strong>StudyOS</strong><br />
            California, United States<br />
            Email: privacy@studyos.io
          </p>
        </div>

        <a href="/" style={{ fontSize: 13, color: "var(--blue)" }}>← Back to StudyOS</a>
      </div>
    </div>
  );
}
