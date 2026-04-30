/**
 * Service to fetch elevation data
 */

export const fetchElevationForRoad = async (coordinates) => {
  // Open-Elevation API is free but can be slow/unreliable for batch
  // For a production app, Mapbox Terrain RGB is better
  // We'll try to fetch a sample of points to build a profile
  
  const step = Math.max(1, Math.floor(coordinates.length / 10)); // Sample ~10 points
  const sampledPoints = coordinates.filter((_, i) => i % step === 0);
  
  try {
    const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: sampledPoints.map(c => ({ latitude: c[1], longitude: c[0] }))
      })
    });

    if (!response.ok) {
      return mockElevation(coordinates);
    }
    const data = await response.json();
    const elevations = data.results.map(r => r.elevation);
    
    return calculateElevationStats(elevations);
  } catch (error) {
    console.error('Elevation API error:', error);
    return mockElevation(coordinates);
  }
};

// --- Tile-based high-resolution terrain fetching ---
// Uses AWS Terrain Tiles (Terrarium format) — free, CORS-enabled, ~10m resolution at zoom 13
// Elevation decode: height = (R * 256 + G + B / 256) - 32768

const lonToTileX = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));

const latToTileY = (lat, z) => {
  const latRad = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
};

const tileToLon = (x, z) => x / Math.pow(2, z) * 360 - 180;

const tileToLat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

export const fetchTerrainGrid = async (coordinates, resolution = 80) => {
  const lats = coordinates.map(c => c[1]);
  const lons = coordinates.map(c => c[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const latPad = Math.max((maxLat - minLat) * 0.25, 0.005);
  const lonPad = Math.max((maxLon - minLon) * 0.25, 0.005);

  const paddedMinLat = minLat - latPad;
  const paddedMaxLat = maxLat + latPad;
  const paddedMinLon = minLon - lonPad;
  const paddedMaxLon = maxLon + lonPad;

  // Zoom 13 gives ~10m/px, zoom 12 gives ~20m/px
  const zoom = 13;

  const tileMinX = lonToTileX(paddedMinLon, zoom);
  const tileMaxX = lonToTileX(paddedMaxLon, zoom);
  const tileMinY = latToTileY(paddedMaxLat, zoom); // Y is inverted
  const tileMaxY = latToTileY(paddedMinLat, zoom);

  const TILE_SIZE = 256;
  const totalWidth = (tileMaxX - tileMinX + 1) * TILE_SIZE;
  const totalHeight = (tileMaxY - tileMinY + 1) * TILE_SIZE;

  try {
    // Fetch all tiles in parallel
    const fetchPromises = [];
    for (let tx = tileMinX; tx <= tileMaxX; tx++) {
      for (let ty = tileMinY; ty <= tileMaxY; ty++) {
        fetchPromises.push(
          fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`)
            .then(r => { if (!r.ok) throw new Error('Tile fetch failed'); return r.blob(); })
            .then(blob => createImageBitmap(blob))
            .then(img => ({ img, dx: (tx - tileMinX) * TILE_SIZE, dy: (ty - tileMinY) * TILE_SIZE }))
        );
      }
    }

    const tiles = await Promise.all(fetchPromises);

    // Stitch into one canvas
    const canvas = new OffscreenCanvas(totalWidth, totalHeight);
    const ctx = canvas.getContext('2d');
    for (const { img, dx, dy } of tiles) {
      ctx.drawImage(img, dx, dy);
    }

    // World bounds of the stitched canvas
    const canvasMinLon = tileToLon(tileMinX, zoom);
    const canvasMaxLon = tileToLon(tileMaxX + 1, zoom);
    const canvasMaxLat = tileToLat(tileMinY, zoom);
    const canvasMinLat = tileToLat(tileMaxY + 1, zoom);

    // Sample a grid from the canvas
    const grid = [];
    for (let i = 0; i < resolution; i++) {
      grid[i] = [];
      const lat = paddedMinLat + (i / (resolution - 1)) * (paddedMaxLat - paddedMinLat);
      for (let j = 0; j < resolution; j++) {
        const lon = paddedMinLon + (j / (resolution - 1)) * (paddedMaxLon - paddedMinLon);

        const px = Math.floor(((lon - canvasMinLon) / (canvasMaxLon - canvasMinLon)) * totalWidth);
        const py = Math.floor(((canvasMaxLat - lat) / (canvasMaxLat - canvasMinLat)) * totalHeight);

        const safeX = Math.max(0, Math.min(totalWidth - 1, px));
        const safeY = Math.max(0, Math.min(totalHeight - 1, py));

        const pixel = ctx.getImageData(safeX, safeY, 1, 1).data;
        // Terrarium decode
        const elevation = (pixel[0] * 256 + pixel[1] + pixel[2] / 256) - 32768;
        grid[i][j] = elevation;
      }
    }

    return { grid, minLat: paddedMinLat, maxLat: paddedMaxLat, minLon: paddedMinLon, maxLon: paddedMaxLon };

  } catch (error) {
    console.error('Terrain tile error:', error);
    // Flat fallback
    const grid = Array(resolution).fill(0).map(() => Array(resolution).fill(300));
    return { grid, minLat: paddedMinLat, maxLat: paddedMaxLat, minLon: paddedMinLon, maxLon: paddedMaxLon };
  }
};


const calculateElevationStats = (elevations) => {
  let gain = 0;
  let loss = 0;
  
  for (let i = 0; i < elevations.length - 1; i++) {
    const diff = elevations[i + 1] - elevations[i];
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  
  return {
    profile: elevations,
    gain: Math.round(gain),
    loss: Math.round(loss),
    avgGrade: (gain / elevations.length).toFixed(1) // Very rough
  };
};

const mockElevation = (coordinates) => {
  // Return random-ish data for demo purposes if API fails
  const elevations = coordinates.map((_, i) => 300 + Math.sin(i / 5) * 50 + Math.random() * 10);
  return calculateElevationStats(elevations);
};
