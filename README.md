# Zundral Web

A resource management village game built with React, TypeScript, and Vite.

## Overview

This is a web-based resource village game where players manage and upgrade buildings to produce resources (Wood, Stone, and Food). The game features a progression system with building levels, warehouse management, and resource production mechanics.

## Features

- **Resource Production**: Manage three types of resources - Wood, Stone, and Food
- **Building Upgrades**: Upgrade production buildings (Lumber Mill, Quarry, Farm) to increase production and capacity
- **Warehouse Management**: Expand warehouse capacity to store more resources
- **Progression System**: Buildings scale with level using mathematical progression formulas
- **Modern UI**: Built with React, TypeScript, and Tailwind CSS

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **PostCSS** - CSS processing

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/JaimeValls/Zundral-Web.git
cd Zundral-Web
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

Or use the provided scripts:
- **Windows (PowerShell)**: `.\start-dev.ps1`
- **Windows (Batch)**: `start.bat`

The development server will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
Zundral-Web/
├── src/
│   ├── App.tsx              # Main app component
│   ├── ResourceVillageUI.tsx # Main game UI component
│   ├── main.tsx             # Entry point
│   └── index.css            # Global styles
├── index.html               # HTML template
├── package.json             # Dependencies and scripts
├── vite.config.ts           # Vite configuration
├── tailwind.config.js       # Tailwind CSS configuration
└── tsconfig.json            # TypeScript configuration
```

## Game Mechanics

### Building Progression

- **Production**: Increases by ×1.25 per level from base values
- **Capacity**: Increases by ×1.30 per level from base 100
- **Upgrade Costs**: Scale with level using a factor of 1.5

### Resource Types

- **Wood**: Produced by Lumber Mill
- **Stone**: Produced by Quarry
- **Food**: Produced by Farm

### Warehouse

- Base capacity: 1000 per resource type at level 1
- Capacity increases by ×1.30 per level
- Upgrade costs scale with level

## Development

This project uses:
- **Vite** for fast development and building
- **TypeScript** for type safety
- **Tailwind CSS** for utility-first styling
- **React Hooks** for state management

## License

This project is private.

## Author

JaimeValls

