// The demo's fiction: a small team shipping a parcel-tracking product with
// eight Claude Code lanes on one agent box, a hypervisor at the office and
// production in the cloud. Every name here is invented.
//
// engine.js animates this; nothing in here moves.
(() => {
  const H = 3600e3;
  const now = Date.now();

  // ---- lanes: id, branch, a plan of stages, and a script of what the
  // session does. The engine walks each script in a loop.
  const lanes = [
    {
      id: 'checkout-v2', branch: 'feat/checkout-v2', hue: 212, stages: 6, stage: 4,
      stageTitle: 'Payment retries', model: 'claude-opus-5-5', startAt: 4, pr: { number: 412, title: 'Checkout v2: one-page flow', checks: 'pending' },
      script: [
        ['working', 'Edit', 'src/checkout/retry.ts'],
        ['working', 'Bash', 'npm test -- checkout'],
        ['working', 'Read', 'src/payments/client.ts'],
        ['working', 'Edit', 'src/checkout/Summary.tsx'],
        ['waiting_permission', 'Bash', 'npx prisma migrate dev --name checkout_retries'],
        ['working', 'Bash', 'npm run typecheck'],
      ],
    },
    {
      id: 'search-reindex', branch: 'perf/search-reindex', hue: 158, stages: 4, stage: 2,
      stageTitle: 'Batch the backfill', model: 'claude-sonnet-5-5',
      script: [
        ['working', 'Grep', 'reindex'],
        ['working', 'Edit', 'jobs/reindex/batch.py'],
        ['working', 'Bash', 'pytest jobs/reindex -q'],
        ['working', 'Edit', 'jobs/reindex/cursor.py'],
      ],
    },
    {
      id: 'flaky-e2e', branch: 'fix/flaky-e2e', hue: 32, stages: 3, stage: 3,
      stageTitle: 'all stages done', model: 'claude-sonnet-5-5', pr: { number: 409, title: 'Stop the tracking-page e2e from flaking', checks: 'success' },
      script: [['done', null, null]],
      marker: ['done', 'LANE-DONE all three stages; PR #409 green, ready to merge'],
    },
    {
      id: 'billing-webhooks', branch: 'feat/billing-webhooks', hue: 280, stages: 5, stage: 2,
      stageTitle: 'Verify signatures', model: 'claude-opus-5-5', startAt: 1,
      script: [
        ['working', 'Read', 'docs/billing/webhooks.md'],
        ['waiting_question', null, null],
      ],
      question: 'Should refunds issued in the dashboard also emit a webhook, or only API refunds?',
      marker: ['need', 'NEED-HUMAN refund webhooks: dashboard refunds too, or API only?'],
    },
    {
      id: 'docs-site', branch: 'docs/new-site', hue: 190, stages: 4, stage: 1,
      stageTitle: 'Port the guides', model: 'claude-haiku-4-5',
      script: [
        ['working', 'Write', 'site/guides/quickstart.md'],
        ['working', 'Edit', 'site/astro.config.mjs'],
        ['working', 'Bash', 'npm run build --prefix site'],
      ],
    },
    {
      id: 'mobile-push', branch: 'feat/mobile-push', hue: 340, stages: 5, stage: 3,
      stageTitle: 'Quiet hours', model: 'claude-opus-5-5', pr: { number: 405, title: 'Push notifications for delivery updates', checks: 'failure' },
      script: [
        ['working', 'Bash', 'npm test -- push'],
        ['working', 'Edit', 'app/push/quietHours.ts'],
        ['working', 'Bash', 'npm test -- push'],
      ],
      marker: ['blocked', 'BLOCKED iOS simulator build fails on the CI runner, not locally'],
    },
    {
      id: 'rate-limiter', branch: 'feat/rate-limiter', hue: 64, stages: 3, stage: 0,
      stageTitle: 'Token bucket', model: 'claude-sonnet-5-5',
      script: [['done', null, null]],
      idle: true,
    },
    {
      id: 'i18n-sweep', branch: 'chore/i18n-sweep', hue: 12, stages: 2, stage: 1,
      stageTitle: 'Extract strings', model: 'claude-haiku-4-5',
      script: [
        ['working', 'Grep', "t\\('"],
        ['working', 'Edit', 'src/i18n/de.json'],
        ['working', 'Edit', 'src/i18n/fr.json'],
      ],
    },
  ];

  // ---- the Map
  const nodes = [
    { id: 'net', kind: 'core', label: 'tailnet' },

    { id: 'office', parent: 'net', kind: 'site', label: 'office', order: 1, detail: { Hardware: '8 cores · 64 GB · one GPU', Where: 'the server cupboard' } },
    { id: 'agents', parent: 'office', kind: 'room', label: 'agents', sub: 'this board · 8 lanes' },
    { id: 'ci', parent: 'office', kind: 'room', label: 'ci', sub: 'two runners' },
    { id: 'staging', parent: 'office', kind: 'room', label: 'staging', sub: 'preview deploys' },
    { id: 'gpu', parent: 'office', kind: 'room', label: 'gpu', sub: 'embeddings · OCR' },
    { id: 'backup', parent: 'office', kind: 'room', label: 'backup', sub: 'nightly' },
    { id: 'lab', parent: 'office', kind: 'room', label: 'lab', sub: 'spare, powered off', expectStopped: true },

    { id: 'runner-1', parent: 'ci', kind: 'service', label: 'runner-1' },
    { id: 'runner-2', parent: 'ci', kind: 'service', label: 'runner-2' },
    { id: 'preview', parent: 'staging', kind: 'service', label: 'preview apps' },
    { id: 'pg-staging', parent: 'staging', kind: 'service', label: 'postgres' },
    { id: 'embed', parent: 'gpu', kind: 'service', label: 'embedder' },
    { id: 'ocr', parent: 'gpu', kind: 'service', label: 'label OCR' },
    { id: 'store', parent: 'backup', kind: 'service', label: 'datastore' },

    { id: 'cloud', parent: 'net', kind: 'site', label: 'cloud', order: 2, sub: 'eu-central' },
    { id: 'web', parent: 'cloud', kind: 'room', label: 'web', probe: true },
    { id: 'api', parent: 'cloud', kind: 'room', label: 'api', probe: true },
    { id: 'db', parent: 'cloud', kind: 'room', label: 'db', sub: 'primary + replica' },
    { id: 'tracking', parent: 'web', kind: 'service', label: 'tracking page' },
    { id: 'checkout', parent: 'web', kind: 'service', label: 'checkout' },
    { id: 'public-api', parent: 'api', kind: 'service', label: 'public API' },
    { id: 'webhooks', parent: 'api', kind: 'service', label: 'webhooks' },
    { id: 'search', parent: 'api', kind: 'service', label: 'search' },

    { id: 'home', parent: 'net', kind: 'site', label: 'home', order: 3, sub: 'one mini PC' },
    { id: 'status', parent: 'home', kind: 'room', label: 'status', sub: 'uptime checks' },
  ];

  const links = [
    { from: 'embed', to: 'ocr', kind: 'share', label: 'share the GPU' },
    { from: 'search', to: 'embed', kind: 'dep', label: 'embeddings' },
    { from: 'db', to: 'store', kind: 'flow', label: 'backups', live: true },
    { from: 'runner-1', to: 'preview', kind: 'flow', label: 'deploys' },
    { from: 'status', to: 'web', kind: 'dep', label: 'watches' },
    { from: 'public-api', to: 'db', kind: 'dep', label: 'reads/writes' },
  ];

  // Which service each lane is changing.
  const laneLinks = {
    'checkout-v2': 'checkout', 'search-reindex': 'search', 'flaky-e2e': 'tracking',
    'billing-webhooks': 'webhooks', 'docs-site': 'preview', 'mobile-push': 'public-api',
    'rate-limiter': 'public-api', 'i18n-sweep': 'tracking',
  };

  window.LANEBOARD_DEMO = { lanes, nodes, links, laneLinks, host: 'agents', repo: 'parcel', startedAt: now - 9 * H };
})();
