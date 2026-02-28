import { useState, useEffect } from 'react';

/**
 * Detects if the device is a mobile/tablet device
 * Primarily uses user agent to avoid false positives on desktop browsers
 * Also checks for touch capability as a secondary indicator
 */
export function useMobileDetection(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    // Check user agent for mobile/tablet indicators (primary check)
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    
    // Check for touch capability (secondary indicator)
    const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    // Check viewport width as tertiary check (but only if UA suggests mobile)
    // This helps catch mobile browsers that might not have mobile UA strings
    const isMobileViewport = window.innerWidth < 768;
    
    // Consider mobile if:
    // 1. User agent indicates mobile/tablet, OR
    // 2. Has touch screen AND viewport is small (likely mobile)
    return isMobileUA || (hasTouchScreen && isMobileViewport);
  });

  useEffect(() => {
    const handleResize = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
      const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
      const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isMobileViewport = window.innerWidth < 768;
      
      setIsMobile(isMobileUA || (hasTouchScreen && isMobileViewport));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

