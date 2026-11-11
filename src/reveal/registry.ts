import type { RevealKind } from '../../shared/schema';
import type { RevealFactory } from './engine';
import { createCracker } from './kinds/cracker';
import { createEgg } from './kinds/egg';
import { createGlobe } from './kinds/globe';
import { createJack } from './kinds/jack';
import { createPresent } from './kinds/present';

export const REVEAL_FACTORIES: Record<RevealKind, RevealFactory> = {
  egg: createEgg,
  jack: createJack,
  present: createPresent,
  cracker: createCracker,
  globe: createGlobe,
};
