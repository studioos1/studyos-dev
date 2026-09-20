// Study/break session-phase signal — a short two-tone chime plus a best-effort browser
// Notification, fired at each Focus Time phase transition (study→break, break→complete).
// Deliberately NOT the place that requests Notification permission — that happens once, either
// during onboarding's Study step or Preferences → Notifications; this only ever checks whether
// it's already granted and stays silent (just the beep) otherwise.

let audioCtx = null;

// `delayMs` lets two tones queue into one short chime without a second timer at the call site.
function tone(freq, durMs, delayMs = 0) {
  setTimeout(() => {
    try {
      if (typeof window === "undefined") return;
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durMs / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + durMs / 1000);
    } catch {}
  }, delayMs);
}

// kind: "break-start" (rising two-tone — winding down) or "break-end" (falling two-tone — back
// to it). title/body are used only for the Notification; the chime plays either way — it's an
// audible session cue tied to actually running Today's Focus Timer, not a "browser notification"
// in the Preferences → Notifications sense, so it isn't gated by notifyBrowserBreaks. `notify`
// (default true) is what the caller sets to that toggle's value — false skips just the desktop
// Notification popup, same idea as this function already only firing it when permission is
// granted, just gated on the user's own preference too now.
export function notifyPhase(kind, title, body, notify = true) {
  if (kind === "break-start") { tone(660, 180, 0); tone(880, 220, 180); }
  else { tone(880, 180, 0); tone(660, 220, 180); }
  if (!notify) return;
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {}
}
