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

export const fetchTerrainGrid = async (coordinates, resolution = 10) => {
  // Calculate bounding box
  const lats = coordinates.map(c => c[1]);
  const lons = coordinates.map(c => c[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  // Add 20% padding
  const latPad = (maxLat - minLat) * 0.2;
  const lonPad = (maxLon - minLon) * 0.2;
  
  const gridLats = [];
  const gridLons = [];
  
  for (let i = 0; i < resolution; i++) {
    gridLats.push((minLat - latPad) + (i / (resolution - 1)) * ((maxLat + latPad) - (minLat - latPad)));
    gridLons.push((minLon - lonPad) + (i / (resolution - 1)) * ((maxLon + lonPad) - (minLon - lonPad)));
  }

  const gridPoints = [];
  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      gridPoints.push({ latitude: gridLats[i], longitude: gridLons[j] });
    }
  }

  try {
    // Call our local serverless proxy to bypass CORS
    const locations = gridPoints.map(p => `${p.latitude},${p.longitude}`).join('|');
    const response = await fetch(`/api/terrain?locations=${locations}`);
    
    if (!response.ok) throw new Error('Terrain grid API failed');
    
    const data = await response.json();
    const grid = [];
    for (let i = 0; i < resolution; i++) {
      grid[i] = [];
      for (let j = 0; j < resolution; j++) {
        grid[i][j] = data.results[i * resolution + j].elevation;
      }
    }

    return {
      grid,
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLon: minLon - lonPad,
      maxLon: maxLon + lonPad
    };
  } catch (error) {
    console.error('Terrain grid error:', error);
    // Mock grid if failed
    const grid = Array(resolution).fill(0).map(() => Array(resolution).fill(300 + Math.random() * 50));
    return {
      grid,
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLon: minLon - lonPad,
      maxLon: maxLon + lonPad
    };
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
