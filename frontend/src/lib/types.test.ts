import { describe, expect, it } from 'vitest'
import {
  BOARD_COLUMNS,
  EXTRA_COLUMNS,
  RUN_ACTIVE,
  RUN_STATUS_ICON,
  RUN_STATUS_LABEL,
  STATUS_CLASS,
  STATUS_ICON,
  STATUS_LABEL,
  STATUSES,
} from './types'

describe('status constants', () => {
  it('board + extra columns exactly cover all statuses', () => {
    expect([...BOARD_COLUMNS, ...EXTRA_COLUMNS]).toEqual(STATUSES)
  })

  it('every status has a label, icon and tint class', () => {
    for (const s of STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy()
      expect(STATUS_ICON[s]).toBeTruthy()
      expect(STATUS_CLASS[s]).toBe(`st-${s}`)
    }
  })
})

describe('run status constants', () => {
  it('labels and icons cover the same run statuses', () => {
    expect(Object.keys(RUN_STATUS_ICON).sort()).toEqual(Object.keys(RUN_STATUS_LABEL).sort())
  })

  it('active statuses are non-terminal ones only', () => {
    expect(RUN_ACTIVE).toEqual(['queued', 'claiming', 'running'])
    for (const s of ['succeeded', 'failed', 'canceled']) {
      expect(RUN_ACTIVE).not.toContain(s)
    }
  })
})
