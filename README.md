# 🏎 Touge Finder

**Touge Finder** is a high-performance discovery engine designed to find the world's best technical driving roads. Built for driving enthusiasts, it moves beyond simple maps to analyze the actual geometry and "flow" of mountain passes and backroads.

![Touge Finder Icon](public/logo.png)

## 🌟 Key Features

### 🔗 Recursive Road Merger
Unlike standard maps that show roads in tiny segments, Touge Finder uses a **Graph-based DFS Merger** to join road segments end-to-end. It follows the logical flow of the asphalt, even across unnamed links and intersections.

### 📐 Sliding Window Scoring (The "Hidden Gem" Finder)
Traditional scoring averages out a whole road, which "dilutes" great sections. Touge Finder uses a **400m Sliding Window**:
- Scans every inch of a road.
- Identifies the most technical 400m section.
- Inherits that peak score for the entire road.
- *Find a 20-mile boring road with one incredible 1-mile hairpin section? Touge Finder will find it.*

### 🛡 Strict Thoroughfare Filtering
Designed for pure driving, the engine automatically filters out urban clutter:
- **Excludes 4+ Lane Roads**: Automatically hides major highways and thoroughfares.
- **Intersection Awareness**: Heavily penalizes roads with frequent stop signs or intersections with major roads.
- **Rural Bias**: Prioritizes remote, uninterrupted "flow" over urban shortcuts.

## 🛠 Tech Stack

- **Frontend**: React + Vite
- **Styling**: Vanilla CSS + Tailwind
- **Mapping**: Leaflet + OpenStreetMap (Overpass API)
- **Geometry**: Turf.js for high-accuracy curvature and distance calculations
- **PWA**: Fully installable on iOS and Android

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation
1. Clone the repo:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Tougefinder.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```

## 📱 Mobile Installation (PWA)
1. Deploy to a service like Vercel (requires HTTPS).
2. Open the URL in Safari (iOS) or Chrome (Android).
3. Tap **"Add to Home Screen"**.

---
*Drive safe. Respect the roads.*
