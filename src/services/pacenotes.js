import * as turf from '@turf/turf';

/**
 * Generates rally-style pacenotes for a given set of coordinates.
 * Coordinates are [lon, lat]
 */
export const generatePacenotes = (coordinates, reverse = false) => {
  const coords = reverse ? [...coordinates].reverse() : coordinates;
  const notes = [];
  
  if (coords.length < 3) return "Road too short for pacenotes.";

  // Simplify the line to remove GPS jitter but keep the curves
  const line = turf.lineString(coords);
  const simplified = turf.simplify(line, { tolerance: 0.0001, highQuality: true });
  const points = simplified.geometry.coordinates;

  let lastBearing = turf.bearing(points[0], points[1]);
  let accumulatedDistance = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    
    const segmentDistance = turf.distance(points[i-1], p1, { units: 'meters' });
    accumulatedDistance += segmentDistance;

    const currentBearing = turf.bearing(p1, p2);
    let diff = currentBearing - lastBearing;

    // Normalize angle to -180 to 180
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const absoluteDiff = Math.abs(diff);

    // Threshold for a "turn" — ignore small adjustments under 10 degrees
    if (absoluteDiff > 12) {
      const direction = diff > 0 ? 'R' : 'L';
      let grade = '';

      // Rally Grading (approximate)
      // 6: 15-30 deg
      // 5: 30-45 deg
      // 4: 45-60 deg
      // 3: 60-80 deg
      // 2: 80-110 deg
      // 1: 110-140 deg
      // Hairpin: >140 deg
      
      if (absoluteDiff > 140) grade = 'Hairpin';
      else if (absoluteDiff > 110) grade = '1';
      else if (absoluteDiff > 80) grade = '2';
      else if (absoluteDiff > 60) grade = '3';
      else if (absoluteDiff > 45) grade = '4';
      else if (absoluteDiff > 30) grade = '5';
      else grade = '6';

      // Add distance since last note
      if (accumulatedDistance > 10) {
        notes.push(Math.round(accumulatedDistance / 10) * 10); // Round to nearest 10m
      }

      notes.push(`${grade} ${direction}`);
      accumulatedDistance = 0;
      lastBearing = currentBearing;
    }
  }

  // Add final distance
  const finalDist = turf.distance(points[points.length - 2], points[points.length - 1], { units: 'meters' });
  accumulatedDistance += finalDist;
  if (accumulatedDistance > 10) {
    notes.push(Math.round(accumulatedDistance / 10) * 10);
  }

  return notes.join('... ');
};

/**
 * Determines the primary cardinal direction of a road segment
 */
export const getCardinalDirection = (p1, p2) => {
  const bearing = turf.bearing(p1, p2);
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((bearing %= 360) < 0 ? bearing + 360 : bearing) / 45) % 8;
  return directions[index];
};
