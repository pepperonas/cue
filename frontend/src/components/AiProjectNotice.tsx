import { useSyncExternalStore } from 'react'
import { clock } from '../lib/clock'
import { contextStatus } from '../lib/project-context'
import type { Project } from '../lib/types'
import { Button, Icon } from './ui'

export function AiProjectNotice({ project, aiReady, onSetup, onRepository }: {
  project: Project | undefined
  aiReady: boolean
  onSetup: () => void
  onRepository: () => void
}) {
  const now = useSyncExternalStore(clock.subscribe, clock.now)
  if (!project) return null
  return (
    <div className="ai-project-notice">
      <div><Icon name="code" /><span>{contextStatus(project, now)}</span></div>
      <Button variant="text" onClick={aiReady ? onRepository : onSetup}>
        {aiReady ? project.github_repo ? 'Projektkontext verwalten' : 'Repository verknüpfen' : 'KI einrichten'}
      </Button>
    </div>
  )
}
