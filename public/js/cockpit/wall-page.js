// The cockpit on the Wall page (cockpit spec screens.md §1, §4, c1-talk.md §1): the
// same button and pane as on the app, over the right 608 px of the Wall, full height.
// Until the Canvas slice the Wall page has one layout, `wall` (screens.md §1, Q-O22 b).
import { initCockpit } from './main.js';

export function bootCockpitWall() {
  initCockpit({ page: 'wall' });
}

bootCockpitWall();
