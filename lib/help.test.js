import { describe, it, expect } from "vitest";
import { gettingStartedStatus } from "./help";

describe("gettingStartedStatus", () => {
  it("is all-false for a brand-new account with nothing set up yet", () => {
    const data = { profile: {} };
    expect(gettingStartedStatus(data)).toEqual({
      school: false, syllabus: false, notifications: false, replan: false, focusTime: false,
    });
  });

  it("school is done once a school exists, independent of everything else", () => {
    const data = { profile: {}, schools: [{ id: "s1" }] };
    expect(gettingStartedStatus(data).school).toBe(true);
  });

  it("syllabus is done once at least one course exists", () => {
    const data = { profile: {}, courses: [{ id: "c1" }] };
    expect(gettingStartedStatus(data).syllabus).toBe(true);
  });

  it("notifications: smsEnabled true counts as done even without browser permission", () => {
    const data = { profile: { smsEnabled: true } };
    expect(gettingStartedStatus(data).notifications).toBe(true);
  });

  it("notifications: smsEnabled false (or unset) does not count as done by itself", () => {
    expect(gettingStartedStatus({ profile: { smsEnabled: false } }).notifications).toBe(false);
    expect(gettingStartedStatus({ profile: {} }).notifications).toBe(false);
  });

  it("notifications is NOT satisfied just by the default browser toggles being true — those default true for every account, so they're not a real signal of anything", () => {
    const data = { profile: { browserNotifsEnabled: true, notifyBrowserPriorities: true, smsEnabled: false } };
    expect(gettingStartedStatus(data).notifications).toBe(false);
  });

  it("replan is done once a quarterPlan exists", () => {
    expect(gettingStartedStatus({ profile: {}, quarterPlan: { weeks: {} } }).replan).toBe(true);
    expect(gettingStartedStatus({ profile: {}, quarterPlan: null }).replan).toBe(false);
  });

  it("focusTime is done from either completionLog or pomodoroLogs having an entry", () => {
    expect(gettingStartedStatus({ profile: {}, completionLog: [{ id: 1 }] }).focusTime).toBe(true);
    expect(gettingStartedStatus({ profile: {}, pomodoroLogs: [{ id: 1 }] }).focusTime).toBe(true);
    expect(gettingStartedStatus({ profile: {}, completionLog: [], pomodoroLogs: [] }).focusTime).toBe(false);
  });

  it("tolerates a missing profile/arrays entirely rather than throwing", () => {
    expect(() => gettingStartedStatus({})).not.toThrow();
    expect(gettingStartedStatus({})).toEqual({
      school: false, syllabus: false, notifications: false, replan: false, focusTime: false,
    });
  });
});
