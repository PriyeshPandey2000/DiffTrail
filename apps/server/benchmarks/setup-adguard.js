import { installCandidate } from './install-candidate.js';
import { candidates } from './candidates.js';
await installCandidate(candidates.adguard);
await import('./build-adguard-api.js');
