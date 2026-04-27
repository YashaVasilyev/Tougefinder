import * as turf from '@turf/turf';

/**
 * Generates rally-style pacenotes for a given set of coordinates.
 * Coordinates are [lon, lat]
 */
export const generatePacenotes = (coordinates, options = {}) => {
  const { reverse = false, format = 'rally' } = options;
  const coords = reverse ? [...coordinates].reverse() : coordinates;
  const notes = [];
  
  if (coords.length < 3) return "Road too short for pacenotes.";

  const line = turf.lineString(coords);
  const simplified = turf.simplify(line, { tolerance: 0.0001, highQuality: true });
  const points = simplified.geometry.coordinates;

  let lastBearing = turf.bearing(points[0], points[1]);
  let accumulatedDistance = 0;

  const descriptiveMap = {
    'Hairpin': 'Hairpin',
    '1': 'Very Tight',
    '2': 'Tight',
    '3': 'Medium',
    '4': 'Moderate',
    '5': 'Wide',
    '6': 'Slight'
  };

  const directionMap = {
    'R': format === 'descriptive' ? 'Right' : 'R',
    'L': format === 'descriptive' ? 'Left' : 'L'
  };

  for (let i = 1; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    
    const segmentDistance = turf.distance(points[i-1], p1, { units: 'meters' });
    accumulatedDistance += segmentDistance;

    const currentBearing = turf.bearing(p1, p2);
    let diff = currentBearing - lastBearing;

    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const absoluteDiff = Math.abs(diff);

    if (absoluteDiff > 12) {
      const dirKey = diff > 0 ? 'R' : 'L';
      let grade = '';
      
      if (absoluteDiff > 140) grade = 'Hairpin';
      else if (absoluteDiff > 110) grade = '1';
      else if (absoluteDiff > 80) grade = '2';
      else if (absoluteDiff > 60) grade = '3';
      else if (absoluteDiff > 45) grade = '4';
      else if (absoluteDiff > 30) grade = '5';
      else grade = '6';

      const distStr = accumulatedDistance > 10 ? `${Math.round(accumulatedDistance / 10) * 10}m: ` : '';
      const turnStr = format === 'descriptive' 
        ? `${descriptiveMap[grade]} ${directionMap[dirKey]}`
        : `${grade}${directionMap[dirKey]}`;

      notes.push(`${distStr}${turnStr}`);
      accumulatedDistance = 0;
      lastBearing = currentBearing;
    }
  }

  const finalDist = turf.distance(points[points.length - 2], points[points.length - 1], { units: 'meters' });
  accumulatedDistance += finalDist;
  if (accumulatedDistance > 10) {
    notes.push(`${Math.round(accumulatedDistance / 10) * 10}m: End of section`);
  }

  return notes.join('\n');
};

/**
 * Determines the primary cardinal direction of a road segment
 */
export const getCardinalDirection = (p1, p2) => {
  const bearing = turf.bearing(p1, p2);
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((bearing % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return directions[index];
};
