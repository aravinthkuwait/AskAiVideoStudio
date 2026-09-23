// Job state machine. Every transition is validated; the worker and the API
// both use compare-and-set updates so a user's Pause is never overwritten.
export const JOB_STATES = ['QUEUED', 'PREPARING', 'GENERATING', 'DOWNLOADING', 'COMPLETED', 'FAILED', 'PAUSED', 'SKIPPED', 'CANCELLED', 'INTERRUPTED'];
export const ACTIVE_STATES = ['PREPARING', 'GENERATING', 'DOWNLOADING'];
export const OPEN_STATES = ['QUEUED', ...ACTIVE_STATES, 'PAUSED', 'INTERRUPTED'];
export const TERMINAL_STATES = ['COMPLETED', 'SKIPPED', 'CANCELLED'];

const T = {
  QUEUED: ['PREPARING', 'PAUSED', 'CANCELLED', 'SKIPPED'],
  PREPARING: ['GENERATING', 'FAILED', 'PAUSED', 'INTERRUPTED', 'CANCELLED', 'SKIPPED'],
  GENERATING: ['DOWNLOADING', 'FAILED', 'PAUSED', 'INTERRUPTED', 'CANCELLED', 'SKIPPED'],
  DOWNLOADING: ['COMPLETED', 'FAILED', 'PAUSED', 'INTERRUPTED', 'CANCELLED', 'SKIPPED'],
  PAUSED: ['QUEUED', 'CANCELLED', 'SKIPPED'],
  FAILED: ['QUEUED', 'SKIPPED', 'CANCELLED'],
  INTERRUPTED: ['QUEUED', 'SKIPPED', 'CANCELLED', 'PAUSED'],
  COMPLETED: [], SKIPPED: [], CANCELLED: [],
};

export const canTransition = (from, to) => (T[from] || []).includes(to);
export const sourcesFor = (to) => Object.keys(T).filter((from) => T[from].includes(to));
