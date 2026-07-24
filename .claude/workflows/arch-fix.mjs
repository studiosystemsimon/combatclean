// arch-fix — review + fix orchestrator.
// Delegates the scout + review phases entirely to the arch-review workflow (single
// source of truth for the trigger-path mapping), then runs the paired fixer agent
// for each dimension that reported violations.
// Fixer agents apply minimal edits and append learned patterns to their own definition.
// Invoke via: Workflow({ name: "arch-fix" })

export const meta = {
  name: 'arch-fix',
  description: 'Review the web game project against relevant architecture rules, then fix any violations. Skips agents with no changes in scope.',
  phases: [
    { title: 'Review' },
    { title: 'Fix' },
    { title: 'Aggregate' },
  ],
};

// Maps each arch-review dimension label to its paired fixer agent type.
const FIXERS = {
  modularity: 'arch-fix-modularity',
  di: 'arch-fix-di',
  events: 'arch-fix-events',
  composition: 'arch-fix-composition',
  specificity: 'arch-fix-specificity',
  view: 'arch-fix-view',
  ui: 'arch-fix-ui',
  'module-docs': 'arch-fix-module-docs',
  'data-values': 'arch-fix-data-values',
};

// ── Phase 1: Review — delegate scout + trigger-filtered review to arch-review ──
phase('Review');
const reviews = await workflow({ scriptPath: '.claude/workflows/arch-review.mjs' });

if (!reviews || reviews.length === 0) {
  log('No review findings — nothing to fix.');
  return [];
}

// Reviewers report clean in one line — violations always use `file:line — issue — fix`.
const toFix = reviews.filter((r) => {
  const lines = (r.report || '').split('\n').filter((l) => l.trim().length > 0);
  return lines.length > 1 || r.report.includes(' — ');
});

log(`${toFix.length}/${reviews.length} dimension(s) have violations — running fixers.`);

// ── Phase 2: Fix dimensions that have violations ───────────────────────────────
phase('Fix');
const fixes = toFix.length > 0
  ? await parallel(
      toFix.map((r) => () =>
        agent(
          [
            `The ${r.dimension} reviewer found the following violations:\n\n${r.report}`,
            '\nApply minimal fixes for each violation.',
            'After fixing, append what you learned to your own agent definition file.',
            'If nothing needs fixing after re-reading the violations, reply "No fixes needed." and stop.',
          ].join('\n'),
          { agentType: FIXERS[r.dimension], label: `fix:${r.dimension}`, phase: 'Fix', model: 'sonnet' },
        )
          .then((result) => ({ dimension: r.dimension, result }))
          .catch(() => ({ dimension: r.dimension, result: '(fixer failed to run)' })),
      ),
    )
  : [];

// ── Phase 3: Aggregate and return ─────────────────────────────────────────────
phase('Aggregate');
const summary = reviews.map((r) => ({
  dimension: r.dimension,
  review: r.report,
  fix: fixes.find((f) => f?.dimension === r.dimension)?.result ?? 'clean — no fix needed',
}));

const fixedCount = fixes.filter((f) => f?.result && !f.result.startsWith('No fixes needed')).length;
log(`arch-fix complete: ${fixedCount}/${toFix.length} dimension(s) fixed.`);

return summary;
