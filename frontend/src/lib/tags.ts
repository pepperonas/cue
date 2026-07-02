// Split a comma-separated tag string into trimmed, non-empty, case-insensitively
// unique tags (keeping the first spelling seen). Used so a prompt can never hold
// the same tag twice.
export function dedupeTags(raw: string | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of (raw ?? '').split(',')) {
    const t = part.trim()
    const key = t.toLowerCase()
    if (t && !seen.has(key)) {
      seen.add(key)
      out.push(t)
    }
  }
  return out
}

// Normalize a tag field to a deduped, comma-separated string.
export function normalizeTags(raw: string | null | undefined): string {
  return dedupeTags(raw).join(', ')
}

// Curated English software-development tags suggested in the tag autocomplete.
// Kept lowercase, single-token (use hyphens, no spaces) so they round-trip
// cleanly through the comma-separated tag field.
export const DEV_TAGS: string[] = [
  // change type
  'feature',
  'enhancement',
  'bug',
  'hotfix',
  'regression',
  'refactor',
  'cleanup',
  'chore',
  'tech-debt',
  'breaking-change',
  'revert',
  // work state / priority
  'wip',
  'blocked',
  'urgent',
  'high-priority',
  'low-priority',
  'idea',
  'research',
  'spike',
  'prototype',
  'mvp',
  'experimental',
  'polish',
  'review',
  'question',
  'duplicate',
  'wontfix',
  // layers / areas
  'frontend',
  'backend',
  'fullstack',
  'api',
  'database',
  'ui',
  'ux',
  'design',
  'infra',
  'devops',
  'tooling',
  'config',
  'dependencies',
  // disciplines
  'security',
  'performance',
  'accessibility',
  'i18n',
  'l10n',
  'seo',
  'testing',
  'unit-test',
  'integration-test',
  'e2e',
  'documentation',
  'logging',
  'monitoring',
  'analytics',
  'error-handling',
  'validation',
  'caching',
  'optimization',
  'migration',
  // delivery
  'build',
  'ci',
  'cd',
  'deploy',
  'release',
  'docker',
  'automation',
  // platforms
  'web',
  'mobile',
  'desktop',
  'pwa',
  // tech
  'typescript',
  'python',
  'rust',
  'go',
  'react',
  'sql',
  'graphql',
  'websocket',
  'styling',
  'animation',
  'responsive',
]
