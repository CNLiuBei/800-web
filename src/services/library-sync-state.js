import { signal } from '../core/signal.js';

/** idle | syncing | done | error */
export const librarySyncState = signal('idle');
