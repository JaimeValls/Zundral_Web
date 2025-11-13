import { useState, useEffect } from 'react'
import { Logger, type LogEvent } from '../../lib/logger'

export function DebugConsole() {
  const [isOpen, setIsOpen] = useState(false)
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogEvent['level'] | 'all'>('all')

  useEffect(() => {
    if (isOpen) {
      const updateLogs = () => setLogs(Logger.get())
      updateLogs()
      const interval = setInterval(updateLogs, 1000)
      return () => clearInterval(interval)
    }
  }, [isOpen])

  const filteredLogs = logs.filter((log) => {
    const matchesFilter = !filter || log.type.toLowerCase().includes(filter.toLowerCase())
    const matchesLevel = levelFilter === 'all' || log.level === levelFilter
    return matchesFilter && matchesLevel
  })

  const handleExport = () => {
    const dataStr = JSON.stringify(filteredLogs, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `logs-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleClear = () => {
    Logger.clear()
    setLogs([])
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString()
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded shadow-lg"
      >
        Debug Console
      </button>
    )
  }

  return (
    <div className="fixed bottom-0 right-0 w-full max-w-2xl h-96 bg-gray-900 text-white shadow-2xl flex flex-col">
      <div className="flex items-center justify-between p-2 bg-gray-800 border-b border-gray-700">
        <h3 className="font-bold">Debug Console</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Filter by type..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-2 py-1 bg-gray-700 text-white rounded text-sm"
          />
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as any)}
            className="px-2 py-1 bg-gray-700 text-white rounded text-sm"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          <button
            onClick={handleExport}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
          >
            Export
          </button>
          <button
            onClick={handleClear}
            className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
          >
            Clear
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-700 rounded text-sm"
          >
            Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-800 sticky top-0">
            <tr>
              <th className="p-2 text-left">Time</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Level</th>
              <th className="p-2 text-left">Payload</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-gray-500">
                  No logs
                </td>
              </tr>
            ) : (
              filteredLogs.map((log, idx) => (
                <tr
                  key={idx}
                  className={`border-b border-gray-700 ${
                    log.level === 'error'
                      ? 'bg-red-900/20'
                      : log.level === 'warn'
                      ? 'bg-yellow-900/20'
                      : ''
                  }`}
                >
                  <td className="p-2">{formatTime(log.ts)}</td>
                  <td className="p-2">{log.type}</td>
                  <td className="p-2">
                    <span
                      className={`px-2 py-1 rounded ${
                        log.level === 'error'
                          ? 'bg-red-600'
                          : log.level === 'warn'
                          ? 'bg-yellow-600'
                          : 'bg-blue-600'
                      }`}
                    >
                      {log.level}
                    </span>
                  </td>
                  <td className="p-2">
                    <pre className="whitespace-pre-wrap break-all">
                      {JSON.stringify(log.payload, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

