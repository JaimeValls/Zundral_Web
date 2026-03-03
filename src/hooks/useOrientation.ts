import { useState, useEffect, useRef } from 'react';

/**
 * Detects the current device orientation.
 * Returns true if landscape (width >= height), false if portrait.
 *
 * Uses 'resize' for immediate updates and a 100 ms debounced
 * 'orientationchange' handler, because iOS/Android may not have updated
 * window.innerWidth yet at the moment the orientationchange event fires.
 */
export function useOrientation(): boolean {
  const [isLandscape, setIsLandscape] = useState<boolean>(() => {
    return window.innerWidth >= window.innerHeight;
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const updateOrientation = () => {
      setIsLandscape(window.innerWidth >= window.innerHeight);
    };

    // 'resize' fires after the viewport dimensions are already updated.
    window.addEventListener('resize', updateOrientation);

    // 'orientationchange' fires before dimensions update on iOS/Android,
    // so read them after a short delay. Only one handler registered.
    const handleOrientationChange = () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(updateOrientation, 100);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', handleOrientationChange);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  return isLandscape;
}
