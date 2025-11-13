export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEvent {
  ts: number
  type: string
  payload: any
  level: LogLevel
}

const MAX_BUFFER_SIZE = 5000

export const Logger = (() => {
  const getBuffer = (): LogEvent[] => {
    try {
      const stored = localStorage.getItem('logBuffer')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  }

  const saveBuffer = (buffer: LogEvent[]) => {
    try {
      localStorage.setItem('logBuffer', JSON.stringify(buffer))
    } catch (e) {
      console.error('Failed to save log buffer:', e)
    }
  }

  const add = (
    type: string,
    payload: any = {},
    level: LogLevel = 'info'
  ): void => {
    const e: LogEvent = {
      ts: Date.now(),
      type,
      payload,
      level,
    }

    const buffer = getBuffer()
    buffer.push(e)

    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.shift()
    }

    saveBuffer(buffer)
    console[level](`[${type}]`, payload)
  }

  const get = (): LogEvent[] => {
    return getBuffer()
  }

  const clear = (): void => {
    try {
      localStorage.removeItem('logBuffer')
    } catch (e) {
      console.error('Failed to clear log buffer:', e)
    }
  }

  return { add, get, clear }
})()
