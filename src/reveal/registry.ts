import type { RevealKind } from '../../shared/schema';
import type { RevealFactory } from './engine';
import { createCracker } from './kinds/cracker';
import { createEgg } from './kinds/egg';
import { createFrost } from './kinds/frost';
import { createGlobe } from './kinds/globe';
import { createPresent } from './kinds/present';

export const REVEAL_FACTORIES: Record<RevealKind, RevealFactory> = {
  egg: createEgg,
  frost: createFrost,
  present: createPresent,
  cracker: createCracker,
  globe: createGlobe,
};
