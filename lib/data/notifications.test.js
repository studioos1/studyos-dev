import { describe, it, expect } from "vitest";
import { iso } from "@/lib/time";
import { pushNotification, markAllNotificationsRead, urgentItems, appendNotification, runNotifyUrgentItems } from "./notifications";

const daysFromNow = (n) => { const d = new Date(iso() + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };

describe("pushNotification", () => {
  it("adds a new unread entry to the front of the log", () => {
    let patch = null;
    const data = { notifications: [{ id: "old", title: "Old", body: "b", createdAt: "2026-01-01T00:00:00.000Z", read: true }] };
    pushNotification(data, (p) => { patch = p; }, { title: "New", body: "hello" });
    expect(patch.notifications).toHaveLength(2);
    expect(patch.notifications[0].title).toBe("New");
    expect(patch.notifications[0].body).toBe("hello");
    expect(patch.notifications[0].read).toBe(false);
    expect(patch.notifications[1].id).toBe("old");
  });

  it("stores an optional priority (used for the amber-highlight styling in App.jsx)", () => {
    let patch = null;
    pushNotification({}, (p) => { patch = p; }, { title: "Urgent", body: "hi", priority: "high" });
    expect(patch.notifications[0].priority).toBe("high");
  });

  it("leaves priority undefined when not passed — a normal-priority entry", () => {
    let patch = null;
    pushNotification({}, (p) => { patch = p; }, { title: "Routine", body: "hi" });
    expect(patch.notifications[0].priority).toBeUndefined();
  });

  it("works from an empty/missing log", () => {
    let patch = null;
    pushNotification({}, (p) => { patch = p; }, { title: "First", body: "hi" });
    expect(patch.notifications).toHaveLength(1);
  });

  it("caps the log at 50 entries, dropping the oldest", () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, title: `T${i}`, body: "", createdAt: "2026-01-01T00:00:00.000Z", read: true }));
    let patch = null;
    pushNotification({ notifications: existing }, (p) => { patch = p; }, { title: "Newest", body: "" });
    expect(patch.notifications).toHaveLength(50);
    expect(patch.notifications[0].title).toBe("Newest");
    expect(patch.notifications.some((n) => n.id === "n49")).toBe(false); // oldest dropped
  });
});

describe("urgentItems", () => {
  it("surfaces an exam up to 5 days out (widened from the old 2-day window)", () => {
    const data = { exams: [{ date: daysFromNow(5), courseId: "c1" }], courses: [{ id: "c1", name: "MMW 122" }], assignments: [] };
    expect(urgentItems(data)).toEqual(["MMW 122 exam — in 5d"]);
  });

  it("excludes an exam more than 5 days out", () => {
    const data = { exams: [{ date: daysFromNow(6), courseId: "c1" }], courses: [{ id: "c1", name: "MMW 122" }], assignments: [] };
    expect(urgentItems(data)).toEqual([]);
  });

  it("surfaces an assignment due up to 2 days out, not 5", () => {
    const data = { assignments: [{ title: "PS4", courseId: "c1", dueDate: daysFromNow(2), status: "open" }], courses: [{ id: "c1", name: "MATH 180A" }], exams: [] };
    expect(urgentItems(data)).toEqual(["PS4 (MATH 180A) — due in 2d"]);
  });

  it("excludes an assignment 3+ days out and one already done", () => {
    const data = {
      assignments: [
        { title: "Far", courseId: "c1", dueDate: daysFromNow(3), status: "open" },
        { title: "Done", courseId: "c1", dueDate: daysFromNow(1), status: "done" },
      ],
      courses: [{ id: "c1", name: "MATH 180A" }], exams: [],
    };
    expect(urgentItems(data)).toEqual([]);
  });

  it("adds a prep-start line on the exact prepDays day, independent of the 5-day window", () => {
    const data = { exams: [{ date: daysFromNow(7), courseId: "c1", prepDays: 7 }], courses: [{ id: "c1", name: "DSC 10" }], assignments: [] };
    expect(urgentItems(data)).toEqual(["Start prep for DSC 10 exam"]);
  });

  it("surfaces a type:'project' assignment up to 5 days out, same window as an exam — real gap this closes: it used to fall into the 2-day homework bucket", () => {
    const data = { assignments: [{ title: "Capstone", type: "project", courseId: "c1", dueDate: daysFromNow(5), status: "open" }], courses: [{ id: "c1", name: "DSC 10" }], exams: [] };
    expect(urgentItems(data)).toEqual(["Capstone (DSC 10) — due in 5d [Project]"]);
  });

  it("excludes a project more than 5 days out", () => {
    const data = { assignments: [{ title: "Capstone", type: "project", courseId: "c1", dueDate: daysFromNow(6), status: "open" }], courses: [{ id: "c1", name: "DSC 10" }], exams: [] };
    expect(urgentItems(data)).toEqual([]);
  });

  it("a non-project assignment 5 days out still stays excluded (only project gets the wider window)", () => {
    const data = { assignments: [{ title: "PS4", courseId: "c1", dueDate: daysFromNow(5), status: "open" }], courses: [{ id: "c1", name: "MATH 180A" }], exams: [] };
    expect(urgentItems(data)).toEqual([]);
  });
});

describe("runNotifyUrgentItems", () => {
  function fakeSupabase() {
    const writes = [];
    return {
      writes,
      from: () => ({
        update: (payload) => ({
          eq: (col, val) => { writes.push({ userId: val, data: payload.data }); return Promise.resolve({ error: null }); },
        }),
      }),
    };
  }

  it("logs a priority:'high' notification for an eligible user with urgent items", async () => {
    const supabase = fakeSupabase();
    const today = daysFromNow(0);
    const rows = [{
      user_id: "u1",
      data: {
        onboarded: true,
        notifications: [],
        exams: [{ date: daysFromNow(3), courseId: "c1" }],
        courses: [{ id: "c1", name: "MMW 122" }],
        assignments: [],
        profile: { notifyBrowserPriorities: true },
      },
    }];
    const results = await runNotifyUrgentItems(supabase, rows, today);
    expect(results[0]).toMatchObject({ user: "u1", logged: true, itemCount: 1 });
    const written = supabase.writes[0].data;
    expect(written.notifications[0].priority).toBe("high");
    expect(written.notifications[0].body).toContain("MMW 122 exam — in 3d");
    expect(written.profile.lastUrgentItemsNotifiedDate).toBe(today);
  });

  it("still marks the date even when nothing is urgent, without adding a notification", async () => {
    const supabase = fakeSupabase();
    const today = daysFromNow(0);
    const rows = [{ user_id: "u1", data: { onboarded: true, notifications: [], exams: [], assignments: [], courses: [], profile: { notifyBrowserPriorities: true } } }];
    const results = await runNotifyUrgentItems(supabase, rows, today);
    expect(results[0]).toMatchObject({ user: "u1", logged: false, itemCount: 0 });
    expect(supabase.writes[0].data.notifications).toEqual([]);
    expect(supabase.writes[0].data.profile.lastUrgentItemsNotifiedDate).toBe(today);
  });

  it("skips a user with reminders off, without writing anything", async () => {
    const supabase = fakeSupabase();
    const rows = [{ user_id: "u1", data: { onboarded: true, profile: { notifyBrowserPriorities: false } } }];
    const results = await runNotifyUrgentItems(supabase, rows, daysFromNow(0));
    expect(results[0]).toMatchObject({ user: "u1", skipped: "not eligible" });
    expect(supabase.writes).toHaveLength(0);
  });

  it("skips a user with the browser-notifications master switch off, even with the specific toggle on", async () => {
    const supabase = fakeSupabase();
    const rows = [{ user_id: "u1", data: { onboarded: true, profile: { browserNotifsEnabled: false, notifyBrowserPriorities: true } } }];
    const results = await runNotifyUrgentItems(supabase, rows, daysFromNow(0));
    expect(results[0]).toMatchObject({ user: "u1", skipped: "not eligible" });
    expect(supabase.writes).toHaveLength(0);
  });

  it("skips a not-yet-onboarded user", () => {
    return (async () => {
      const supabase = fakeSupabase();
      const rows = [{ user_id: "u1", data: { onboarded: false, profile: { notifyBrowserPriorities: true } } }];
      const results = await runNotifyUrgentItems(supabase, rows, daysFromNow(0));
      expect(results[0]).toMatchObject({ user: "u1", skipped: "not eligible" });
      expect(supabase.writes).toHaveLength(0);
    })();
  });

  it("is idempotent — skips a user already run today, without writing anything", async () => {
    const supabase = fakeSupabase();
    const today = daysFromNow(0);
    const rows = [{ user_id: "u1", data: { onboarded: true, profile: { notifyBrowserPriorities: true, lastUrgentItemsNotifiedDate: today } } }];
    const results = await runNotifyUrgentItems(supabase, rows, today);
    expect(results[0]).toMatchObject({ user: "u1", skipped: "already ran today" });
    expect(supabase.writes).toHaveLength(0);
  });
});

describe("appendNotification", () => {
  it("is the shape both pushNotification and runNotifyUrgentItems build from", () => {
    const result = appendNotification([], { title: "T", body: "B", priority: "high" });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "T", body: "B", priority: "high", read: false });
    expect(result[0].id).toBeDefined();
    expect(result[0].createdAt).toBeDefined();
  });
});

describe("markAllNotificationsRead", () => {
  it("marks every entry read in one pass", () => {
    let patch = null;
    const data = { notifications: [
      { id: "a", title: "A", body: "", createdAt: "2026-01-01T00:00:00.000Z", read: false },
      { id: "b", title: "B", body: "", createdAt: "2026-01-01T00:00:00.000Z", read: false },
    ] };
    markAllNotificationsRead(data, (p) => { patch = p; });
    expect(patch.notifications.every((n) => n.read)).toBe(true);
  });

  it("no-ops (no upd call) when nothing is unread", () => {
    let called = false;
    const data = { notifications: [{ id: "a", title: "A", body: "", createdAt: "2026-01-01T00:00:00.000Z", read: true }] };
    markAllNotificationsRead(data, () => { called = true; });
    expect(called).toBe(false);
  });

  it("no-ops on an empty log", () => {
    let called = false;
    markAllNotificationsRead({ notifications: [] }, () => { called = true; });
    expect(called).toBe(false);
  });
});
