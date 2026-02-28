import React from 'react';

/**
 * Full-screen overlay that appears when mobile device is in portrait mode
 * Prompts user to rotate device to landscape orientation
 */
export default function RotateOverlay() {
  return (
    <div className="fixed inset-0 z-[99999] bg-slate-950 flex items-center justify-center flex-col p-8">
      {/* Rotate Icon */}
      <div className="mb-8 animate-pulse">
        <svg
          className="w-24 h-24 sm:w-32 sm:h-32 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </div>

      {/* Message */}
      <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-100 mb-4 text-center">
        Please Rotate Your Device
      </h2>
      <p className="text-lg sm:text-xl md:text-2xl text-slate-400 text-center max-w-md">
        This game is only playable in horizontal (landscape) mode.
      </p>

      {/* Decorative elements */}
      <div className="mt-12 flex gap-4">
        <div className="w-3 h-3 rounded-full bg-slate-600 animate-pulse" style={{ animationDelay: '0s' }}></div>
        <div className="w-3 h-3 rounded-full bg-slate-600 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
        <div className="w-3 h-3 rounded-full bg-slate-600 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
      </div>
    </div>
  );
}

