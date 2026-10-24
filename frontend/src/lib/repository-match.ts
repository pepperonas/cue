import type { GitHubRepo } from './types'

function words(name: string): string[] {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').match(/[\p{L}\p{N}]+/gu) ?? []
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = previous
    }
  }
  return row[b.length]
}

function similarity(project: string[], repository: string[]): number {
  const target = project.join('')
  const candidate = repository.join('')
  if (!target || !candidate) return 0
  if (target === candidate) return 1
  const lengthRatio = Math.min(target.length, candidate.length) / Math.max(target.length, candidate.length)
  // Whole words beat accidental substrings: pi-tools ahead of pilot or api.
  if (` ${repository.join(' ')} `.includes(` ${project.join(' ')} `)) return 0.85 + 0.1 * lengthRatio
  if (candidate.startsWith(target)) return 0.75 + 0.1 * lengthRatio
  return 0.75 * (1 - editDistance(target, candidate) / Math.max(target.length, candidate.length))
}

/** Compare the repository NAME, not its owner. Ties keep GitHub's recent-first order. */
export function rankRepositories(repositories: readonly GitHubRepo[], projectName: string): GitHubRepo[] {
  const name = projectName.trim().split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? ''
  const target = words(name)
  return repositories
    .map((repo, index) => ({ repo, index, score: similarity(target, words(repo.full_name.split('/').slice(-1)[0] ?? '')) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ repo }) => repo)
}
