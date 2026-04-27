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
