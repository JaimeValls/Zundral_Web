import React from 'react'
import ResourceVillageUI from './ResourceVillageUI'
import RotateOverlay from './components/RotateOverlay'
import { useMobileDetection } from './hooks/useMobileDetection'
import { useOrientation } from './hooks/useOrientation'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  const isMobile = useMobileDetection()
  const isLandscape = useOrientation()

  // Show rotate overlay only on mobile devices in portrait mode
  const showRotateOverlay = isMobile && !isLandscape

  return (
    <div className="bg-gray-900 min-h-screen text-slate-100">
      <ErrorBoundary>
        {showRotateOverlay && <RotateOverlay />}
        <div className={showRotateOverlay ? 'hidden' : ''}>
          <ResourceVillageUI />
        </div>
      </ErrorBoundary>
    </div>
  )
}

export default App
