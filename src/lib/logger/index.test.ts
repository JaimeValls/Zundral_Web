import { describe, it, expect, beforeEach } from 'vitest'
import { Logger } from './index'

describe('Logger', () => {
  beforeEach(() => {
    Logger.clear()
  })

  it('adds log events', () => {
    Logger.add('test_event', { data: 'test' })
    const logs = Logger.get()
    expect(logs.length).toBe(1)
    expect(logs[0].type).toBe('test_event')
    expect(logs[0].payload.data).toBe('test')
  })

  it('persists to localStorage', () => {
    Logger.add('test_event', { data: 'test' })
    const logs = Logger.get()
    expect(logs.length).toBe(1)
  })

  it('clears logs', () => {
    Logger.add('test_event', { data: 'test' })
    Logger.clear()
    const logs = Logger.get()
    expect(logs.length).toBe(0)
  })

  it('respects max buffer size', () => {
    for (let i = 0; i < 6000; i++) {
      Logger.add('test_event', { index: i })
    }
    const logs = Logger.get()
    expect(logs.length).toBeLessThanOrEqual(5000)
  })
})

