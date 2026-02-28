@echo off
title Zundral Web - Vite Dev Server
color 0A

echo ================================================
echo   Zundral Web - Starting Dev Server
echo ================================================
echo.
echo IMPORTANT: Close Live Server or any other dev server first!
echo.
echo Waiting 3 seconds...
timeout /t 3 /nobreak >nul
echo.
echo Starting Vite...
echo.
echo Once you see "Local:  http://localhost:5173"
echo  - You can also use  http://192.168.1.18:5173  from other devices
echo.
echo Press Ctrl+C in this window to stop the server.
echo ================================================
echo.

REM Start Vite bound to all network interfaces so phones/tablets can reach it
call npm run dev -- --host 0.0.0.0 --port 5173

echo.
echo Server stopped. Press any key to exit...
pause >nul
