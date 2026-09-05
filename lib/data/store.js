import { STORE } from "./schema";
import { supabase } from "@/lib/supabase";

// load()/save() are the app's whole persistence seam — components/App.jsx's initial load and its
// upd() save path are the only callers. As of Phase C2 the backend is Supabase: one row per user
// in public.user_data holding the entire app state as a JSON blob (same shape the browser used to
// keep in localStorage). Both functions are async and both no-op to null / nothing when there's no
// logged-in user, so App.jsx's auth gate decides when they actually run.

// Shape-normalisation applied to whatever comes back from storage, cloud or local. These are
// defensive coercions for data written by older versions / import edge cases — not business logic.
function migrate(d) {
  if (!d) return null;
  if (d.profile) {
    const num = ["breakfastDur","lunchDur","dinnerDur","focusMins","breakMins","sessionPreset","commuteMins","funWD","funWE","gymStretch","gymDrive"];
    num.forEach(k => { if (d.profile[k] !== undefined) d.profile[k] = parseInt(d.profile[k]) || 0; });
    if (d.profile.gymDays) {
      d.profile.gymDays = d.profile.gymDays.map(g => ({ ...g, day: parseInt(g.day) || 0 }));
    }
  }
  if (Array.isArray(d.courses)) {
    d.courses = d.courses.map(c => ({
      ...c,
      days: Array.isArray(c.days) ? c.days : [],
      weeklyHours: Number.isFinite(+c.weeklyHours) && +c.weeklyHours > 0 ? +c.weeklyHours : 4,
      difficulty: Number.isFinite(+c.difficulty) && +c.difficulty >= 1 && +c.difficulty <= 10 ? +c.difficulty : 5,
    }));
  }
  if (Array.isArray(d.assignments)) {
    d.assignments = d.assignments.map(a => ({ ...a, dueDate: (a.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) ? a.dueDate : null }));
  }
  if (Array.isArray(d.exams)) {
    d.exams = d.exams.filter(e => e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  }
  return d;
}

// One-time bridge for anyone who used the pre-Supabase (localStorage-only) build: if their cloud
// row is empty but the old browser blob is still there, adopt it as the starting point and push it
// up. Fires only when the cloud side is genuinely empty, so it can't clobber real cloud data.
function readLegacyLocal() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && typeof d === "object" ? d : null;
  } catch { return null; }
}

async function currentUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

export async function load() {
  const uid = await currentUserId();
  if (!uid) return null;

  const { data: row, error } = await supabase
    .from("user_data")
    .select("data")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    console.error("StudyOS: failed to load data from Supabase —", error.message);
    return null;
  }

  const cloud = row?.data;
  if (cloud && Object.keys(cloud).length > 0) return migrate(cloud);

  // Cloud row missing or empty — try adopting the legacy local blob once.
  const legacy = readLegacyLocal();
  if (legacy) {
    await save(legacy);
    return migrate(legacy);
  }
  return null;
}

export async function save(d) {
  const uid = await currentUserId();
  if (!uid) return;

  const { error } = await supabase
    .from("user_data")
    .upsert({ user_id: uid, data: d, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) console.error("StudyOS: failed to save data to Supabase —", error.message);
}
