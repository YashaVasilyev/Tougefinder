import * as turf from '@turf/turf';

const calculateRadius = (p1, p2, p3) => {
  const a = turf.distance(p1, p2, { units: 'meters' });
  const b = turf.distance(p2, p3, { units: 'meters' });
  const c = turf.distance(p1, p3, { units: 'meters' });
  const s = (a + b + c) / 2;
  const areaSq = s * (s - a) * (s - b) * (s - c);
  if (areaSq <= 0) return Infinity;
  return (a * b * c) / (4 * Math.sqrt(areaSq));
};

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
    'HP': 'Hairpin',
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
    const pPrev = points[i-1];
    const pCurr = points[i];
    const pNext = points[i+1];
    
    const segmentDistance = turf.distance(pPrev, pCurr, { units: 'meters' });
    accumulatedDistance += segmentDistance;

    const currentBearing = turf.bearing(pCurr, pNext);
    let diff = currentBearing - lastBearing;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const absoluteDiff = Math.abs(diff);

    // Detected a turn (> 10 degrees)
    if (absoluteDiff > 10) {
      const radius = calculateRadius(pPrev, pCurr, pNext);
      const dirKey = diff > 0 ? 'R' : 'L';
      let grade = '';
      
      // Updated Grading Logic
      if (absoluteDiff > 150 && radius < 30) {
        grade = 'HP';
      } else if (radius < 10) {
        grade = '1'; // Sharp
      } else if (radius < 20) {
        grade = '2'; // Tight
      } else if (radius < 50) {
        grade = '3'; // Medium
      } else if (radius < 100) {
        grade = '4'; // Moderate
      } else if (radius < 180) {
        grade = '5'; // Wide
      } else {
        grade = '6'; // Slight
      }

      const distStr = accumulatedDistance > 10 ? `${Math.round(accumulatedDistance / 10) * 10}m: ` : '';
      const displayGrade = format === 'descriptive' ? descriptiveMap[grade] : grade;
      const turnStr = `${displayGrade} ${directionMap[dirKey]}`;

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
