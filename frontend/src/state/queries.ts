import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Project, Prompt, Status } from '../lib/types'

const PROMPTS_KEY = ['prompts'] as const
const PROJECTS_KEY = ['projects'] as const

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

export function projectMap(projects: Project[] | undefined): Map<number, Project> {
  return new Map((projects ?? []).map((p) => [p.id, p]))
}
