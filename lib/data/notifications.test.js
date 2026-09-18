import { describe, it, expect } from "vitest";
import { pushNotification, markAllNotificationsRead } from "./notifications";

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
