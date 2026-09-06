import { useEffect, useMemo } from "react";
import { computePlanDiagnostics } from "@/lib/planDiagnostics";

const round1 = n => Math.round(n * 10) / 10;

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--t3)", margin: "0 0 7px" }}>
      {children}
    </div>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div style={{ background: "var(--card2)", borderRadius: 8, padding: "8px 11px", minWidth: 92, flex: "1 1 auto" }}>
      <div style={{ fontSize: 10.5, color: "var(--t3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: warn ? "var(--amber)" : "var(--t1)", marginTop: 2 }}>{value}</div>
    </div>
  );
}

// Table header / cell — same visual language as the Academics Assignments / Difficulty tabs.
function Th({ children, right }) {
  return (
    <th style={{
      fontSize: 11, color: "var(--t3)", textTransform: "uppercase", letterSpacing: "0.04em",
      textAlign: right ? "right" : "left", padding: "0 8px 8px", fontWeight: 600, whiteSpace: "nowrap",
    }}>{children}</th>
  );
}
function Td({ children, right, muted, nowrap, style }) {
  return (
    <td style={{
      padding: "9px 8px", fontSize: 13, color: muted ? "var(--t2)" : "var(--t1)",
      textAlign: right ? "right" : "left", whiteSpace: nowrap ? "nowrap" : undefined, ...style,
    }}>{children}</td>
  );
}

// Non-modal right-side slide-over for plan status + diagnostics. Opened by the Weekly-tab "Plan
// status" button and auto-opened after a replan that leaves items short. The grid stays visible
// and usable behind it — close via the X or Esc.
export function PlanDrawer({ open, onClose, data }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const diag = useMemo(() => (open ? computePlanDiagnostics(data) : null), [open, data]);
  if (!open) return null;

  const qp = data.quarterPlan;
  const t = diag?.totals;

  return (
    <div style={{
      position: "fixed", top: 92, right: 0, bottom: 0, width: "min(600px,100vw)", zIndex: 95,
      background: "var(--card)", borderLeft: "1px solid var(--b1)", boxShadow: "-10px 0 34px rgba(0,0,0,0.4)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "13px 16px", borderBottom: "1px solid var(--b1)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <i className="ti ti-stethoscope" style={{ fontSize: 17, color: "var(--blue)" }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Plan status</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close" style={{ padding: "4px 8px" }}>
          <i className="ti ti-x" style={{ fontSize: 16 }} />
        </button>
      </div>

      <div style={{ padding: "14px 16px", overflowY: "auto", flex: 1 }}>

        <SectionLabel>Last full replan</SectionLabel>
        {qp ? (
          <div style={{ fontSize: 12.5, color: "var(--t2)", lineHeight: 1.6, marginBottom: 18 }}>
            Generated {qp.generatedAt} · through {qp.generatedThrough} · {qp.datesPlanned || Object.keys(qp.tasksByDate || {}).length} days
            {qp.lastError && (
              <div style={{ color: "var(--red)", marginTop: 5 }}>⚠ Last error ({qp.lastErrorAt}): {qp.lastError}</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--t3)", marginBottom: 18 }}>
            Never run — hit <b>Replan</b> to build your study plan.
          </div>
        )}

        {!diag ? (
          <div style={{ fontSize: 12.5, color: "var(--t3)" }}>
            Set your term dates in <b>Settings → School Info</b> to see the plan analysis.
          </div>
        ) : (
          <>
            <SectionLabel>Analysis · today → {diag.horizon.end} ({diag.horizon.days} days)</SectionLabel>
            <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
              <Stat label="Study demand" value={`${t.desiredH}h`} />
              <Stat label="Planned" value={`${t.plannedH}h`} />
              <Stat
                label="Short"
                value={t.shortItems ? `${t.shortItems} item${t.shortItems !== 1 ? "s" : ""} · ${t.shortH}h` : "none"}
                warn={t.shortItems > 0}
              />
              {diag.overdue.length > 0 && (
                <Stat label="Overdue" value={`${diag.overdue.length} item${diag.overdue.length !== 1 ? "s" : ""}`} warn />
              )}
            </div>

            {diag.overdue.length > 0 && (
              <>
                <SectionLabel>Overdue — mark these done or reschedule</SectionLabel>
                <div style={{ overflowX: "auto", marginBottom: 18 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--b1)" }}>
                        <Th>Item</Th><Th>Class</Th><Th>Due</Th><Th right>Needed</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {diag.overdue.map((it, i) => (
                        <tr key={it.id} style={{ borderBottom: i < diag.overdue.length - 1 ? "1px solid var(--b1)" : "none" }}>
                          <Td>{it.title}</Td>
                          <Td muted>{it.courseName}</Td>
                          <Td muted nowrap style={{ color: "var(--red)" }}>{it.dueDate}</Td>
                          <Td right muted>{it.desiredHours}h</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <SectionLabel>Per item · today forward</SectionLabel>
            {diag.items.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--t3)" }}>No active assignments or exams in range.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--b1)" }}>
                      <Th>Item</Th><Th>Class</Th><Th>Due</Th><Th>Diff</Th>
                      <Th right>Priority</Th><Th right>Need/Plan</Th><Th right>Short</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.items.map((it, i) => (
                      <tr key={it.id} style={{ borderBottom: i < diag.items.length - 1 ? "1px solid var(--b1)" : "none" }}>
                        <Td>{it.title}</Td>
                        <Td muted nowrap>{it.courseName}</Td>
                        <Td muted nowrap>{it.dueDate || "—"}</Td>
                        <Td muted>{it.difficulty || "—"}</Td>
                        <Td right muted>{it.priority != null ? it.priority : "—"}</Td>
                        <Td right nowrap>{it.desiredHours}/{it.plannedHours}h</Td>
                        <Td right nowrap style={{ color: it.fullyCovered ? "var(--t3)" : "var(--amber)", fontWeight: it.fullyCovered ? 400 : 600 }}>
                          {it.fullyCovered ? "—" : `−${round1(it.shortfallHours)}h`}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
