import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import { Home } from '../ui/screens/Home'
import { Village } from '../ui/screens/Village'
import { Army } from '../ui/screens/Army'
import { Missions } from '../ui/screens/Missions'
import { Reports } from '../ui/screens/Reports'
import { DebugConsole } from '../ui/widgets/DebugConsole'
import { DevPanel } from '../ui/widgets/DevPanel'

type Screen = 'home' | 'village' | 'army' | 'missions' | 'reports'

function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home')

  const screens = {
    home: <Home />,
    village: <Village />,
    army: <Army />,
    missions: <Missions />,
    reports: <Reports />,
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-4">
            <button
              onClick={() => setCurrentScreen('home')}
              className={`py-4 px-4 ${
                currentScreen === 'home'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Home
            </button>
            <button
              onClick={() => setCurrentScreen('village')}
              className={`py-4 px-4 ${
                currentScreen === 'village'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Village
            </button>
            <button
              onClick={() => setCurrentScreen('army')}
              className={`py-4 px-4 ${
                currentScreen === 'army'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Army
            </button>
            <button
              onClick={() => setCurrentScreen('missions')}
              className={`py-4 px-4 ${
                currentScreen === 'missions'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Missions
            </button>
            <button
              onClick={() => setCurrentScreen('reports')}
              className={`py-4 px-4 ${
                currentScreen === 'reports'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Reports
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-4">
        {screens[currentScreen]}
      </main>

      <DebugConsole />
      <DevPanel />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
