# How to Run Zundral Web

## The Problem
If you see a white page or "Wrong Server Detected" message, you're using the wrong server. This project needs **Vite's dev server**, not Live Server or a simple HTTP server.

## Solution: Use Vite Dev Server

### Method 1: Double-Click Launcher (Easiest)
1. **Close Live Server** (if it's running)
2. **Double-click** `start-dev.bat` in this folder
3. Wait for the terminal to show: `Local: http://localhost:5173`
4. **Open that URL** in your browser

### Method 2: Command Line
1. **Close Live Server** (if it's running)
2. Open PowerShell or Command Prompt in this folder
3. Run: `npm run dev`
4. Wait for the output showing the URL (usually `http://localhost:5173`)
5. **Open that URL** in your browser

### Method 3: From VS Code
1. **Close Live Server** (if it's running)
2. Press `Ctrl + `` (backtick) to open terminal
3. Run: `npm run dev`
4. Click the URL shown in the terminal output

## Why This Happens
- **Live Server** (port 5500) can't process TypeScript/JSX files
- **Vite** (port 5173) transpiles TypeScript and React on the fly
- Your code is in TypeScript (`.tsx`), so it needs Vite to work

## Troubleshooting

### "Port 5173 already in use"
- Another Vite server might be running
- Close other terminals or restart your computer

### "npm: command not found"
- Install Node.js from https://nodejs.org/
- Restart your terminal after installing

### Still seeing white page?
1. Make sure you're opening `http://localhost:5173` (not `index.html` directly)
2. Check the browser console (F12) for errors
3. Make sure the terminal shows "VITE ready"

## Quick Reference
- ✅ **Correct URL**: `http://localhost:5173`
- ❌ **Wrong URL**: `http://127.0.0.1:5500/index.html` or `file:///...`

