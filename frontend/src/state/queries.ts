import { useEffect, useMemo, useRef } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '../lib/api'
import type { BookmarkMovePayload, MovePayload } from '../lib/api'
import { pendingProposal, succeededVersions } from '../lib/optimization'
import type { OptimizationDecisionResult } from '../lib/types'
import type { Optimization, Project, Prompt, StatsQuery, TagSort } from '../lib/types'
import { RUN_ACTIVE } from '../lib/types'

const PROMPTS_KEY = ['prompts'] as const
const PROJECTS_KEY = ['projects'] as const

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.me() })
}

export function usePrompts() {
  return useQuery({ queryKey: PROMPTS_KEY, queryFn: () => api.listPrompts() })
}

/** Statistics dashboard. Cached per range; the backend invalidates its own
 *  cache on every mutation, so a short staleTime is enough here. */
export function useStats(query: StatsQuery, enabled = true) {
  return useQuery({
    queryKey: ['stats', query.range, query.from ?? '', query.to ?? ''],
    queryFn: () => api.stats(query),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev, // keep the old numbers while a range switches
  })
}

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: () => api.listProjects() })
}

export function useCreatePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createPrompt,
    onSuccess: (prompt) => {
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) => [...(old ?? []), prompt])
      qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function useUpdatePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof api.updatePrompt>[1] }) =>
      api.updatePrompt(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: PROMPTS_KEY })
      const prev = qc.getQueryData<Prompt[]>(PROMPTS_KEY)
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) =>
        (old ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PROMPTS_KEY, ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: PROMPTS_KEY })
      qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function useDuplicatePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, projectId }: { id: number; projectId: number | null }) =>
      api.duplicatePrompt(id, projectId),
    onSuccess: (prompt) => {
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) => [...(old ?? []), prompt])
      qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function useDuplicateInPlace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.duplicatePromptInPlace(id),
    onSuccess: (prompt) => {
      // Appending is enough for instant feedback: the copy shares the source's
      // sort_order, so columnComparator slots it right below the original.
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) => [...(old ?? []), prompt])
      qc.invalidateQueries({ queryKey: PROMPTS_KEY })
      qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function useDeletePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deletePrompt(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PROMPTS_KEY })
      const prev = qc.getQueryData<Prompt[]>(PROMPTS_KEY)
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) => (old ?? []).filter((p) => p.id !== id))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PROMPTS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

// Anchored move (drag result). The optimistic part only mirrors the status
// change — the ordering itself is the server's answer, and the board keeps its
// own drag result on screen until the refetch lands, so nothing flickers.
export function useMovePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...move }: MovePayload & { id: number }) => api.movePrompt(id, move),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: PROMPTS_KEY })
      const prev = qc.getQueryData<Prompt[]>(PROMPTS_KEY)
      if (status) {
        qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) =>
          (old ?? []).map((p) => (p.id === id ? { ...p, status } : p)),
        )
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PROMPTS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROMPTS_KEY }),
  })
}

/** Move a board multi-selection between the columns in one request. */
export function useMovePrompts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, ...move }: MovePayload & { ids: number[] }) => api.movePrompts(ids, move),
    onMutate: async ({ ids, status }) => {
      await qc.cancelQueries({ queryKey: PROMPTS_KEY })
      const prev = qc.getQueryData<Prompt[]>(PROMPTS_KEY)
      if (status) {
        const picked = new Set(ids)
        qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) =>
          (old ?? []).map((p) =>
            // Blocked prompts are skipped server-side, so don't fake their move.
            picked.has(p.id) && !(p.blocked && status !== 'queued') ? { ...p, status } : p,
          ),
        )
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PROMPTS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROMPTS_KEY }),
  })
}

export function useMoveBookmark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...move }: BookmarkMovePayload & { id: number }) =>
      api.moveBookmark(id, move),
    onSettled: () => qc.invalidateQueries({ queryKey: PROMPTS_KEY }),
  })
}

export function useMergePrompts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.mergePrompts,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROMPTS_KEY })
      qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

// ---- Prompt capture history ----
export function useSessions(enabled: boolean) {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.listSessions(),
    enabled,
    refetchInterval: enabled ? 5000 : false,
  })
}

export function useSession(id: number | null) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => api.getSession(id as number),
    enabled: !!id,
    refetchInterval: 4000,
  })
}

export function usePromoteCaptured() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, cpId }: { sessionId: number; cpId: number }) =>
      api.promoteCaptured(sessionId, cpId),
    onSuccess: (prompt) => {
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) => [...(old ?? []), prompt])
      qc.invalidateQueries({ queryKey: PROMPTS_KEY })
      qc.invalidateQueries({ queryKey: PROJECTS_KEY })
    },
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

export function useSendToSession() {
  return useMutation({
    mutationFn: ({ sessionId, text, submit }: { sessionId: number; text: string; submit: boolean }) =>
      api.sendToSession(sessionId, text, submit),
  })
}

/**
 * The caller's own Anthropic key.
 *
 * Every approved user may read this, key or not — storing one is how somebody
 * gets the optimization feature in the first place, so it must not sit behind
 * the permission it grants. Invalidating the optimize config on save is what
 * makes the ✨ buttons appear without a reload.
 */
export function useApiKey() {
  return useQuery({ queryKey: ['api-key'], queryFn: () => api.apiKey() })
}

export function useSaveApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { key?: string; model?: string }) => api.saveApiKey(patch),
    onSuccess: (data) => {
      qc.setQueryData(['api-key'], data)
      qc.invalidateQueries({ queryKey: ['optimize-config'] })
    },
  })
}

export function useCaptureSettings() {
  return useQuery({ queryKey: ['capture-settings'], queryFn: () => api.getCaptureSettings() })
}

export function useUpdateCaptureSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { project_base?: string; regenerate?: boolean }) =>
      api.updateCaptureSettings(patch),
    onSuccess: (data) => qc.setQueryData(['capture-settings'], { ...data, token: undefined }),
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) =>
      api.createProject(name, color),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; color?: string } }) =>
      api.updateProject(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

export function useReorderProjects() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; sort_order: number }[]) => api.reorderProjects(items),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: PROJECTS_KEY })
      const prev = qc.getQueryData<Project[]>(PROJECTS_KEY)
      const byId = new Map(items.map((i) => [i.id, i.sort_order]))
      qc.setQueryData<Project[]>(PROJECTS_KEY, (old) =>
        [...(old ?? [])]
          .map((p) => (byId.has(p.id) ? { ...p, sort_order: byId.get(p.id) as number } : p))
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PROJECTS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROJECTS_KEY })
      qc.invalidateQueries({ queryKey: PROMPTS_KEY })
    },
  })
}

// ---- Run engine ----
const RUNS_KEY = ['runs'] as const

// Succeeds only for the owner; a 403 means the run feature is hidden.
export function useRunConfig() {
  return useQuery({ queryKey: ['run-config'], queryFn: () => api.runConfig(), retry: false })
}

export function useRuns(enabled: boolean) {
  return useQuery({
    queryKey: RUNS_KEY,
    queryFn: () => api.listRuns(),
    enabled,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => RUN_ACTIVE.includes(r.status)) ? 3000 : false,
  })
}

export function useRun(id: string | null) {
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => api.getRun(id as string),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && RUN_ACTIVE.includes(q.state.data.status) ? 2000 : false),
  })
}

export function useCreateRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.createRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RUNS_KEY })
      // The server moved the source prompts into the Running column.
      qc.invalidateQueries({ queryKey: PROMPTS_KEY })
    },
  })
}

export function useCancelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.cancelRun(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: RUNS_KEY })
      qc.invalidateQueries({ queryKey: ['run', id] })
      // A canceled queued run releases its prompts back into the queue.
      qc.invalidateQueries({ queryKey: PROMPTS_KEY })
    },
  })
}

export function projectMap(projects: Project[] | undefined): Map<number, Project> {
  return new Map((projects ?? []).map((p) => [p.id, p]))
}

// ---- Snippets ----
import { snippetsApi } from '../lib/api'
import type { SnippetGroup } from '../lib/types'

const SNIPPETS_KEY = ['snippets'] as const
const SNIPPET_GROUPS_KEY = ['snippet-groups'] as const

export function useSnippets() {
  return useQuery({ queryKey: SNIPPETS_KEY, queryFn: snippetsApi.list })
}

export function useSnippetGroups() {
  return useQuery({ queryKey: SNIPPET_GROUPS_KEY, queryFn: snippetsApi.groups })
}

function useInvalidateSnippets() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: SNIPPETS_KEY })
    void qc.invalidateQueries({ queryKey: SNIPPET_GROUPS_KEY })
  }
}

export function useCreateSnippet() {
  const invalidate = useInvalidateSnippets()
  return useMutation({
    mutationFn: snippetsApi.create,
    onSuccess: invalidate,
  })
}

export function useUpdateSnippet() {
  const invalidate = useInvalidateSnippets()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof snippetsApi.update>[1] }) =>
      snippetsApi.update(id, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteSnippet() {
  const invalidate = useInvalidateSnippets()
  return useMutation({ mutationFn: snippetsApi.remove, onSuccess: invalidate })
}

export function useReorderSnippets() {
  const qc = useQueryClient()
  const invalidate = useInvalidateSnippets()
  return useMutation({
    mutationFn: snippetsApi.reorder,
    // Optimistic: apply the new group/sort to the cache before the server answers.
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: SNIPPETS_KEY })
      const previous = qc.getQueryData<import('../lib/types').Snippet[]>(SNIPPETS_KEY)
      if (previous) {
        const patch = new Map(items.map((i) => [i.id, i]))
        qc.setQueryData(
          SNIPPETS_KEY,
          previous.map((s) => {
            const p = patch.get(s.id)
            return p ? { ...s, group_name: p.group_name || null, sort_order: p.sort_order } : s
          }),
        )
      }
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(SNIPPETS_KEY, ctx.previous)
    },
    onSettled: invalidate,
  })
}

export function useBulkMoveSnippets() {
  const invalidate = useInvalidateSnippets()
  return useMutation({
    mutationFn: ({ ids, groupName }: { ids: number[]; groupName: string }) =>
      snippetsApi.bulkMove(ids, groupName),
    onSuccess: invalidate,
  })
}

export function useBulkDeleteSnippets() {
  const invalidate = useInvalidateSnippets()
  return useMutation({ mutationFn: snippetsApi.bulkDelete, onSuccess: invalidate })
}

export function useCreateSnippetGroup() {
  const invalidate = useInvalidateSnippets()
  return useMutation({ mutationFn: snippetsApi.createGroup, onSuccess: invalidate })
}

export function useRenameSnippetGroup() {
  const invalidate = useInvalidateSnippets()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => snippetsApi.renameGroup(id, name),
    onSuccess: invalidate,
  })
}

export function useDeleteSnippetGroup() {
  const invalidate = useInvalidateSnippets()
  return useMutation({ mutationFn: snippetsApi.deleteGroup, onSuccess: invalidate })
}

export function useReorderSnippetGroups() {
  const invalidate = useInvalidateSnippets()
  return useMutation({ mutationFn: snippetsApi.reorderGroups, onSuccess: invalidate })
}

export function useImportSnippets() {
  const invalidate = useInvalidateSnippets()
  return useMutation({ mutationFn: snippetsApi.importBackup, onSuccess: invalidate })
}

// ---- Snippet sync with Inspector Rust ----
const SYNC_SETTINGS_KEY = ['sync-settings'] as const

export function useSyncSettings() {
  return useQuery({ queryKey: SYNC_SETTINGS_KEY, queryFn: snippetsApi.getSyncSettings })
}

export function useUpdateSyncSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { regenerate?: boolean; sync_ungrouped?: boolean }) =>
      snippetsApi.updateSyncSettings(patch),
    onSuccess: (data) => qc.setQueryData(SYNC_SETTINGS_KEY, data),
  })
}

// Optimistic per-group sync toggle so the header button flips instantly.
export function useToggleGroupSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, synced }: { id: number; synced: boolean }) =>
      snippetsApi.setGroupSynced(id, synced),
    onMutate: async ({ id, synced }) => {
      await qc.cancelQueries({ queryKey: SNIPPET_GROUPS_KEY })
      const prev = qc.getQueryData<SnippetGroup[]>(SNIPPET_GROUPS_KEY)
      qc.setQueryData<SnippetGroup[]>(SNIPPET_GROUPS_KEY, (old) =>
        (old ?? []).map((g) => (g.id === id ? { ...g, synced } : g)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(SNIPPET_GROUPS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SNIPPET_GROUPS_KEY }),
  })
}

// ---- Admin: user approval ----
const ADMIN_USERS_KEY = ['admin-users'] as const

export function useAdminUsers(enabled: boolean) {
  return useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: api.adminListUsers,
    enabled,
  })
}

export function useSetUserApproval() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approved }: { id: number; approved: boolean }) =>
      api.adminSetApproval(id, approved),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ADMIN_USERS_KEY }),
  })
}

// ---- Prompt optimization -------------------------------------------------
// Owner-only, executed by the Mac runner: the hooks poll while something is in
// flight and stop as soon as the queue is empty (same pattern as runs).
const OPTIMIZATIONS_KEY = ['optimizations'] as const

export function useOptimizeConfig() {
  return useQuery({
    queryKey: ['optimize-config'],
    queryFn: () => api.optimizeConfig(),
    retry: false, // a 403 means "not the owner" -> hide the feature
  })
}

/** All queued/running jobs — drives the per-prompt spinner and the ticker. */
export function useActiveOptimizations(enabled: boolean) {
  return useQuery({
    queryKey: OPTIMIZATIONS_KEY,
    queryFn: () => api.activeOptimizations(),
    enabled,
    refetchInterval: (q) => ((q.state.data ?? []).length ? 2000 : false),
  })
}

/**
 * Refresh the prompts when an optimization leaves the active list.
 *
 * The active-jobs query stops polling once nothing is running, and nothing else
 * touches the prompts — so a finished proposal stayed invisible: the card kept
 * its ✨, the detail showed no diff, and only a manual reload revealed that
 * there was anything to decide.
 */
export function useRefreshOnOptimizationFinish(activeIds: number[]): void {
  const qc = useQueryClient()
  const key = activeIds.join(',')
  const previous = useRef(key)
  useEffect(() => {
    const before = previous.current ? previous.current.split(',') : []
    const now = key ? key.split(',') : []
    previous.current = key
    if (before.some((id) => !now.includes(id))) {
      qc.invalidateQueries({ queryKey: PROMPTS_KEY })
    }
  }, [key, qc])
}

export function useOptimizationHistory(promptId: number | null) {
  return useQuery({
    queryKey: ['optimizations', promptId],
    queryFn: () => api.optimizationHistory(promptId as number),
    enabled: promptId !== null,
  })
}

/** The proposal this prompt is holding open for review, or null.
 *
 *  Shares the history query with `OptimizationPanel` (React Query dedupes by
 *  key), so the pinned decision bar in the detail sheet costs no extra request
 *  and can never disagree with the diff shown above it. */
export function usePendingProposal(prompt: Prompt | null): Optimization | null {
  const { data } = useOptimizationHistory(prompt?.id ?? null)
  return useMemo(
    () => (prompt ? pendingProposal(prompt, succeededVersions(data)) : null),
    [prompt, data],
  )
}

export function useOptimizeBatch(enabled: boolean) {
  return useQuery({
    queryKey: ['optimize-batch'],
    queryFn: () => api.activeOptimizationBatch(),
    enabled,
    refetchInterval: (q) => (q.state.data && !q.state.data.finished_at ? 2000 : false),
  })
}

export function useOptimizePrompt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ promptId, provider }: { promptId: number; provider?: string }) =>
      api.optimizePrompt(promptId, provider),
    onSuccess: (job) => {
      // Show the spinner immediately instead of waiting for the next poll.
      qc.setQueryData<Optimization[]>(OPTIMIZATIONS_KEY, (old) => [...(old ?? []), job])
      qc.invalidateQueries({ queryKey: ['optimizations', job.prompt_id] })
    },
  })
}

export function useCancelOptimization() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.cancelOptimization(id),
    onSettled: () => qc.invalidateQueries({ queryKey: OPTIMIZATIONS_KEY }),
  })
}

/**
 * Review a proposal: apply it into the prompt text, or drop it.
 *
 * The response carries the updated prompt, so the card loses its pending state
 * (and shows the new body) in the same tick — no refetch race.
 */
function useOptimizationDecision(decide: (id: number) => Promise<OptimizationDecisionResult>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: decide,
    onSuccess: ({ prompt }) => {
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) =>
        (old ?? []).map((p) => (p.id === prompt.id ? prompt : p)),
      )
      qc.invalidateQueries({ queryKey: ['optimizations', prompt.id] })
      qc.invalidateQueries({ queryKey: OPTIMIZATIONS_KEY })
    },
  })
}

export function useApplyOptimization() {
  return useOptimizationDecision(api.applyOptimization)
}

export function useDiscardOptimization() {
  return useOptimizationDecision(api.discardOptimization)
}

export function useStartOptimizeBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.startOptimizationBatch,
    onSuccess: (batch) => {
      qc.setQueryData(['optimize-batch'], batch)
      qc.invalidateQueries({ queryKey: OPTIMIZATIONS_KEY })
    },
  })
}

export function useCancelOptimizeBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.cancelOptimizationBatch(id),
    onSuccess: (batch) => qc.setQueryData(['optimize-batch'], batch),
    onSettled: () => qc.invalidateQueries({ queryKey: OPTIMIZATIONS_KEY }),
  })
}

// ---- Central tag vocabulary ----------------------------------------------
// One cached list feeds both the manager and the autocomplete; every mutation
// also invalidates prompts (their cached tag strings change) and the stats.
const TAGS_KEY = ['tags'] as const

export function useTags(params: { q?: string; sort?: TagSort } = {}) {
  return useQuery({
    queryKey: [...TAGS_KEY, params.q ?? '', params.sort ?? 'usage'],
    queryFn: () => api.listTags(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev, // keep the list while typing a filter
  })
}

export function useTagUsage(id: number | null) {
  return useQuery({
    queryKey: ['tag-usage', id],
    queryFn: () => api.tagUsage(id as number),
    enabled: id !== null,
  })
}

function invalidateTagConsumers(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: TAGS_KEY })
  qc.invalidateQueries({ queryKey: PROMPTS_KEY })
  qc.invalidateQueries({ queryKey: ['stats'] })
}

export function useCreateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.createTag(name),
    onSuccess: () => invalidateTagConsumers(qc),
  })
}

export function useRenameTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.renameTag(id, name),
    onSuccess: () => invalidateTagConsumers(qc),
  })
}

export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, replaceWith }: { id: number; replaceWith?: number | null }) =>
      api.deleteTag(id, replaceWith),
    onSuccess: () => invalidateTagConsumers(qc),
  })
}
