// Route module: `cockpit` in GET /api/v1/hello (builder only), the same value
// the board's /ws hello carries (server/ws.mjs `helloMessage().cockpit`, D93,
// D17, D129): true when this process runs a room (`cockpit.agent`) or its
// front forwards /api/cockpit/ to one (`cockpit.forwarded`).
//
// Why a second place (build B107): the page's board socket (public/js/core/net.js)
// and its store (public/js/core/store.js) are fenced and keep only the fields
// they knew, so the page cannot read `hello.cockpit` off /ws until the owner
// applies docs/plans/cockpit/build/patches/T15-store-hello-cockpit.diff. Until
// then the cockpit's client reads this field instead; after the patch it reads
// the store and this field is only a fallback. It says nothing a page could not
// learn by opening /api/cockpit/ws.
import { addHelloField } from '../fleet/api-v1.mjs';
import { cockpitConfigured } from '../config/cockpit.mjs';

export default {
  name: 'cockpit-hello',
  modes: ['builder'],
  register(ctx) {
    try {
      addHelloField('cockpit', () => cockpitConfigured(ctx.config));
    } catch (err) {
      // A second load of this module (tests) is a no-op; any other refusal is a bug.
      if (!/already registered/.test(String(err?.message))) throw err;
    }
  },
};
