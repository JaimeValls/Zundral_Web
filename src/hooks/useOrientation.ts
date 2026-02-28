import { useState, useEffect } from 'react';

/**
 * Detects the current device orientation
 * Returns true if landscape (width >= height), false if portrait
 */
export function useOrientation(): boolean {
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    return window.innerWidth >= window.innerHeight;
  });

  useEffect(() => {
    const updateOrientation = () => {
      setIsLandscape(window.innerWidth >= window.innerHeight);
    };

    // Listen to both resize and orientationchange events
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);
    
    // Also check after a short delay to handle orientation change properly
    const handleOrientationChange = () => {
      setTimeout(updateOrientation, 100);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  return isLandscape;
}

