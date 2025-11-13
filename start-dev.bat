@echo off
title Zundral Web - Vite Dev Server
color 0A
echo ========================================
echo   Zundral Web - Starting Dev Server
echo ========================================
echo.
echo IMPORTANT: Close Live Server first!
echo.
echo Waiting 3 seconds...
timeout /t 3 /nobreak >nul
echo.
echo Starting Vite...
echo.
echo Once you see "Local: http://localhost:5173"
echo   - Copy that URL
echo   - Open it in your browser
echo   - DO NOT open index.html directly
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.
call npm run dev
echo.
echo Server stopped. Press any key to exit...
pause >nul

