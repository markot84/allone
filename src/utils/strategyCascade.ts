import { isSectionHidden } from '../config/modules';

/**
 * The cascade: once a weight change settles, the modules it flows through light up in sequence.
 *
 * This is the visual argument that the tools are one system rather than several — the most
 * important thing the demo has to say — so it is driven by a real event from the Configurator when
 * a change settles, not by a timer that runs on its own.
 */
export const STRATEGY_CASCADE_EVENT = 'pp-strategy-cascade';

/** Gap between two modules lighting up. */
export const CASCADE_STEP_MS = 120;

/** How long a single module stays lit; matches the reveal duration in the token set. */
export const CASCADE_HOLD_MS = 450;

/** Strategy → Products → Channels → Content, per the brief. */
const CASCADE_CHAIN = ['strategy', 'products', 'channels', 'calendar'];

/**
 * Hidden modules drop out rather than lighting up something with no menu entry — `channels` is
 * hidden in this build, so the chain runs Strategy → Products → Content. Unhiding it puts it back
 * in place automatically.
 */
export function cascadeChain(): string[] {
  return CASCADE_CHAIN.filter((section) => !isSectionHidden(section));
}

export function emitStrategyCascade(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STRATEGY_CASCADE_EVENT));
}
