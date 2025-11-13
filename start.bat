@echo off
REM Change to the batch file's directory (project root)
cd /d "%~dp0"

REM Refresh PATH to include Node.js
call refreshenv >nul 2>&1
set "PATH=%PATH%;C:\Program Files\nodejs"

REM Check if Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    echo Or run: winget install OpenJS.NodeJS.LTS
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo npm version:
npm --version
echo.

echo Installing dependencies...
call npm install
if errorlevel 1 (
    echo Failed to install dependencies!
    pause
    exit /b 1
)

echo.
echo Starting development server...
echo.
echo The server will be available at http://localhost:5173
echo Press Ctrl+C to stop the server
echo.
call npm run dev

