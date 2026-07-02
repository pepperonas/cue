import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Project, Prompt, Status } from '../lib/types'
import { RUN_ACTIVE } from '../lib/types'

const PROMPTS_KEY = ['prompts'] as const
const PROJECTS_KEY = ['projects'] as const

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.me() })
}

export function usePrompts() {
  return useQuery({ queryKey: PROMPTS_KEY, queryFn: () => api.listPrompts() })
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

// Reorder applies a full optimistic snapshot immediately (drag result), then
// syncs the touched rows to the server in one transaction.
export function useReorder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; status: Status; sort_order: number }[]) =>
      api.reorder(items),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: PROMPTS_KEY })
      const prev = qc.getQueryData<Prompt[]>(PROMPTS_KEY)
      const byId = new Map(items.map((i) => [i.id, i]))
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) =>
        (old ?? []).map((p) => {
          const next = byId.get(p.id)
          return next ? { ...p, status: next.status, sort_order: next.sort_order } : p
        }),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PROMPTS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROMPTS_KEY }),
  })
}

// Bookmark drag-sort: optimistic snapshot of bookmark_order, then sync.
export function useReorderBookmarks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; bookmark_order: number }[]) =>
      api.reorderBookmarks(items),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: PROMPTS_KEY })
      const prev = qc.getQueryData<Prompt[]>(PROMPTS_KEY)
      const byId = new Map(items.map((i) => [i.id, i]))
      qc.setQueryData<Prompt[]>(PROMPTS_KEY, (old) =>
        (old ?? []).map((p) => {
          const next = byId.get(p.id)
          return next ? { ...p, bookmark_order: next.bookmark_order } : p
        }),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PROMPTS_KEY, ctx.prev)
    },
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
    onSuccess: () => qc.invalidateQueries({ queryKey: RUNS_KEY }),
  })
}

export function useCancelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.cancelRun(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: RUNS_KEY })
      qc.invalidateQueries({ queryKey: ['run', id] })
    },
  })
}

export function projectMap(projects: Project[] | undefined): Map<number, Project> {
  return new Map((projects ?? []).map((p) => [p.id, p]))
}
