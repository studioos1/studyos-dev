import { useEffect, useMemo, useState } from "react";
import { computePlanDiagnostics } from "@/lib/planDiagnostics";
import { HoursInput } from "@/components/shared";

const round1 = n => Math.round(n * 10) / 10;

function SectionLabel({ children, alert }) {
  return (
    <div style={{
      fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em",
      color: alert ? "var(--red)" : "var(--t3)", fontWeight: alert ? 700 : 400,
      margin: "0 0 7px", display: "flex", alignItems: "center", gap: 6,
    }}>
      {alert && <i className="ti ti-alert-triangle" style={{ fontSize: 13 }} />}
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
      padding: "8px 8px", fontSize: 13, color: muted ? "var(--t2)" : "var(--t1)",
      textAlign: right ? "right" : "left", whiteSpace: nowrap ? "nowrap" : undefined, ...style,
    }}>{children}</td>
  );
}

// Both tables share one column layout so data lines up left-to-right between them; the Overdue
// table just leaves the planner-only columns blank. Kept lean enough to fit the drawer without
// a horizontal scroll.
const COLS = ["", "Item", "Class", "Due", "Diff", "Priority", "Need", "Short", ""];
const RIGHT_FROM = 4, RIGHT_TO = 7; // Diff..Short are right-aligned

// Non-modal right-side slide-over for plan status, diagnostics, and quick fixes. Opened by the
// Weekly-tab "Plan status" button and auto-opened after a replan that leaves items short. The grid
// stays visible and usable behind it — close via the X or Esc.
export function PlanDrawer({ open, onClose, data, upd, refreshQuarterPlan }) {
  const [sel, setSel] = useState(() => new Set());

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

  // ── mutations ──────────────────────────────────────────────────────────────
  const arrKey = it => (it.kind === "exam" ? "exams" : "assignments");
  const patch = (it, fields, extra = {}) => {
    const k = arrKey(it);
    upd({ [k]: data[k].map(x => (x.id === it.rawId ? { ...x, ...fields } : x)), ...extra });
  };
  const markDone = it => patch(it, { status: "done" });
  const setHours = (it, v) => patch(it, { userHours: v }, { planStale: true });
  const setForced = (it, val) => patch(it, { forced: val }, { planStale: true });

  function prioritiseSelected() {
    const chosen = (diag?.items || []).filter(it => sel.has(it.id));
    if (!chosen.length) return;
    const aIds = new Set(chosen.filter(c => c.kind === "assignment").map(c => c.rawId));
    const eIds = new Set(chosen.filter(c => c.kind === "exam").map(c => c.rawId));
    upd({
      assignments: data.assignments.map(a => (aIds.has(a.id) ? { ...a, forced: true } : a)),
      exams: data.exams.map(e => (eIds.has(e.id) ? { ...e, forced: true } : e)),
    });
    setSel(new Set());
    refreshQuarterPlan?.();
  }

  const toggleSel = id => setSel(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div style={{
      position: "fixed", top: 92, right: 0, bottom: 0, width: "min(760px,100vw)", zIndex: 95,
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

      {data.planStale && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "9px 16px",
          background: "var(--amber-bg)", color: "var(--amber)", fontSize: 12.5, flexShrink: 0,
        }}>
          <i className="ti ti-alert-triangle" style={{ fontSize: 14 }} />
          Changes not applied yet.
          <button className="btn btn-sm" style={{ marginLeft: "auto", background: "var(--amber)", color: "#1a0e00" }}
            onClick={() => refreshQuarterPlan?.()}>
            Replan now
          </button>
        </div>
      )}

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
              <Stat label="Short"
                value={t.shortItems ? `${t.shortItems} item${t.shortItems !== 1 ? "s" : ""} · ${t.shortH}h` : "none"}
                warn={t.shortItems > 0} />
              {diag.overdue.length > 0 && (
                <Stat label="Overdue" value={`${diag.overdue.length} item${diag.overdue.length !== 1 ? "s" : ""}`} warn />
              )}
            </div>

            {diag.overdue.length > 0 && (
              <>
                <SectionLabel alert>Overdue — mark done now, or reschedule the due date</SectionLabel>
                <div style={{ overflowX: "auto", marginBottom: 18 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--b1)" }}>
                        {COLS.map((c, i) => <Th key={i} right={i >= RIGHT_FROM && i <= RIGHT_TO}>{c}</Th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {diag.overdue.map((it, i) => (
                        <tr key={it.id} style={{ borderBottom: i < diag.overdue.length - 1 ? "1px solid var(--b1)" : "none" }}>
                          <Td />
                          <Td nowrap>{it.title}</Td>
                          <Td muted nowrap>{it.courseName}</Td>
                          <Td nowrap style={{ color: "var(--red)", fontWeight: 600 }}>{it.dueDate}</Td>
                          <Td right muted>—</Td>
                          <Td right muted>—</Td>
                          <Td right muted nowrap>{it.desiredHours}h</Td>
                          <Td right muted>—</Td>
                          <Td right>
                            <button className="btn btn-sm btn-action tt" data-tt="Mark this done" style={{ padding: "3px 8px" }}
                              onClick={() => markDone(it)}>
                              <i className="ti ti-check" style={{ fontSize: 13 }} />
                            </button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 7px" }}>
              <SectionLabel>Per item · today forward</SectionLabel>
              {sel.size > 0 && (
                <button className="btn btn-sm btn-action" style={{ marginLeft: "auto", padding: "3px 10px" }}
                  onClick={prioritiseSelected}>
                  <i className="ti ti-star" style={{ fontSize: 12 }} /> Prioritise {sel.size} → fill 100%
                </button>
              )}
            </div>
            {diag.items.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--t3)" }}>No active assignments or exams in range.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--b1)" }}>
                      {COLS.map((c, i) => <Th key={i} right={i >= RIGHT_FROM && i <= RIGHT_TO}>{c}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {diag.items.map((it, i) => (
                      <tr key={it.id} style={{ borderBottom: i < diag.items.length - 1 ? "1px solid var(--b1)" : "none" }}>
                        <Td>
                          <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggleSel(it.id)}
                            style={{ width: 14, height: 14, cursor: "pointer" }} />
                        </Td>
                        <Td nowrap>
                          {it.forced && (
                            <i className="ti ti-star-filled tt" data-tt="Prioritised — click to clear"
                              onClick={() => setForced(it, false)}
                              style={{ fontSize: 12, color: "var(--amber)", cursor: "pointer", marginRight: 5 }} />
                          )}
                          {it.title}
                        </Td>
                        <Td muted nowrap>{it.courseName}</Td>
                        <Td muted nowrap>{it.dueDate || "—"}</Td>
                        <Td right muted>{it.difficulty || "—"}</Td>
                        <Td right muted>{it.priority != null ? it.priority : "—"}</Td>
                        <Td right nowrap style={{ padding: "3px 8px" }}>
                          <HoursInput value={it.desiredHours} isOverridden={it.forced}
                            onCommit={v => v != null && setHours(it, v)} />
                        </Td>
                        <Td right nowrap style={{ color: it.fullyCovered ? "var(--t3)" : "var(--amber)", fontWeight: it.fullyCovered ? 400 : 600 }}>
                          {it.fullyCovered ? "—" : `−${round1(it.shortfallHours)}h`}
                        </Td>
                        <Td />
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11.5, color: "var(--t3)", marginTop: 8, lineHeight: 1.6 }}>
                  Tick items and <b>Prioritise</b> to make the planner fill them to 100% (taking time from the rest).
                  Edit <b>Need</b> hours to lower an estimate. Then <b>Replan</b> to apply.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
