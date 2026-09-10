// Agents Office · R3F scene — the one store for discrete scene state.
// Continuous state (positions, poses, tweens) lives on refs and the camera rig, never here.
import { createStore } from 'zustand/vanilla';

export const store = createStore(() => ({
  focused: null,        // department key while zoomed into a pod ('brain' = the centre)
  selected: null,       // agent id whose rail is open (the figure stands and waves)
  dark: false,          // body.dark — set by the clock (night) or forced with D / #dark=1
  cam: false,           // camera mode: mid-tone backdrop for filming
  phase: 'day',         // morning · day · evening · night (src/scene/daylight.js)
  manualPhase: null,    // a phase the owner pinned (N key / #phase=) — null follows the clock
  manualDark: null,     // true/false once D or #dark= was used — null follows the phase
  hover: null,          // agent id under the pointer
}));

export const set = store.setState;
export const get = store.getState;
