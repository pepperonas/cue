import { describe, expect, it } from 'vitest'
import { optimizeTicker } from './optimize-ticker'
import type { Optimization, Project, Prompt } from './types'

const prompt = (id: number, project_id: number | null, title = `Prompt ${id}`) =>
  ({ id, project_id, title }) as Prompt
const project = (id: number, github_repo: string | null) => ({ id, github_repo }) as Project
const job = (o: Partial<Optimization>) =>
  ({ id: 1, prompt_id: 1, batch_id: null, status: 'queued', context_ref: '', ...o }) as Optimization

const prompts = [prompt(1, 10, 'Sortierung umbauen'), prompt(2, 20), prompt(3, null)]
const projects = [project(10, 'octo/app'), project(20, null)]

describe('optimizeTicker', () => {
  it('is silent when nothing is happening', () => {
    expect(optimizeTicker([], [], prompts, projects)).toBeNull()
  })

  it('says the context is being fetched while the POST of a linked prompt runs', () => {
    const s = optimizeTicker([1], [], prompts, projects)
    expect(s?.phase).toBe('context')
    expect(s?.text).toMatch(/GitHub/)
    expect(s?.detail).toBe('octo/app')
  })

  it('does not claim a GitHub fetch for a prompt without a linked repository', () => {
    expect(optimizeTicker([2], [], prompts, projects)?.phase).toBe('queueing')
    expect(optimizeTicker([3], [], prompts, projects)?.phase).toBe('queueing')
  })

  it('the POST phase wins over jobs already queued', () => {
    expect(optimizeTicker([1], [job({ prompt_id: 2 })], prompts, projects)?.phase).toBe('context')
  })

  it('names the prompt and the context of a running job', () => {
    const s = optimizeTicker([], [job({ status: 'running', context_ref: 'octo/app@abc1234' })], prompts, projects)
    expect(s?.phase).toBe('running')
    expect(s?.text).toBe('Wird optimiert')
    expect(s?.detail).toBe('mit Kontext octo/app@abc1234 · Sortierung umbauen')
  })

  it('says so when a job runs without context', () => {
    const s = optimizeTicker([], [job({ prompt_id: 2 })], prompts, projects)
    expect(s?.phase).toBe('queued')
    expect(s?.detail).toBe('ohne Projektkontext · Prompt 2')
  })

  it('leaves batch jobs to the batch ticker', () => {
    expect(optimizeTicker([], [job({ batch_id: 'b1', status: 'running' })], prompts, projects)).toBeNull()
  })

  it('ignores finished jobs still in the list', () => {
    expect(optimizeTicker([], [job({ status: 'succeeded' })], prompts, projects)).toBeNull()
  })

  it('summarises several jobs instead of naming one', () => {
    const s = optimizeTicker(
      [],
      [job({ id: 1, status: 'running' }), job({ id: 2, prompt_id: 2 })],
      prompts,
      projects,
    )
    expect(s?.text).toBe('2 Prompts werden optimiert')
    expect(s?.detail).toBe('1 laufen gerade')
  })
})
