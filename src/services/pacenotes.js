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
  let coords = reverse ? [...coordinates].reverse() : coordinates;
  
  if (coords.length < 3) return "Road too short for pacenotes.";

  // --- Step 1: Resample the road to consistent 5m segments ---
  const line = turf.lineString(coords);
  const totalLength = turf.length(line, { units: 'meters' });
  const stepSize = 5; 
  const points = [];
  for (let d = 0; d <= totalLength; d += stepSize) {
    points.push(turf.along(line, d, { units: 'meters' }).geometry.coordinates);
  }
  // Ensure the last point is included
  if (totalLength % stepSize !== 0) {
    points.push(coords[coords.length - 1]);
  }

  const descriptiveMap = {
    'HP': 'Hairpin',
    '1': 'Very Tight',
    '2': 'Tight',
    '3': 'Medium',
    '4': 'Moderate',
    '5': 'Wide',
    '6': 'Slight',
    'S': 'Straight'
  };

  const severityOrder = { 'S': 0, '6': 1, '5': 2, '4': 3, '3': 4, '2': 5, '1': 6, 'HP': 7 };

  // --- Step 2: Initial Classification ---
  // Look 20m ahead and behind for radius (4 steps of 5m)
  const lookDistance = 4;
  let candidates = [];
  let lastGrade = 'S';
  let lastDir = null;

  for (let i = lookDistance; i < points.length - lookDistance; i++) {
    const pPrev = points[i - lookDistance];
    const pCurr = points[i];
    const pNext = points[i + lookDistance];
    
    const radius = calculateRadius(pPrev, pCurr, pNext);
    
    // Bearing diff for direction and hairpin detection
    const b1 = turf.bearing(pPrev, pCurr);
    const b2 = turf.bearing(pCurr, pNext);
    let diff = b2 - b1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    const absDiff = Math.abs(diff);

    let grade = 'S';
    if (absDiff > 150 && radius < 30) grade = 'HP';
    else if (radius < 15) grade = '1';
    else if (radius < 30) grade = '2';
    else if (radius < 60) grade = '3';
    else if (radius < 120) grade = '4';
    else if (radius < 250) grade = '5';
    else if (radius < 500) grade = '6';

    const dir = diff > 0 ? 'R' : 'L';
    
    if (grade !== lastGrade || (grade !== 'S' && dir !== lastDir)) {
      candidates.push({
        index: i,
        grade,
        dir: grade === 'S' ? null : dir,
        distance: i * stepSize
      });
      lastGrade = grade;
      lastDir = grade === 'S' ? null : dir;
    }
  }

  // --- Step 3: Filtering Descending Severity ---
  // We don't care if a turn opens up; we care about the tightest part.
  for (let i = candidates.length - 1; i > 0; i--) {
    const current = candidates[i];
    const prev = candidates[i - 1];
    if (current.dir === prev.dir && severityOrder[prev.grade] >= severityOrder[current.grade] && current.grade !== 'S') {
      candidates.splice(i, 1);
    }
  }

  // --- Step 4: Collapsing Ascending Severity ---
  // If severity increases within 30m, use the higher severity for the start of the turn.
  for (let i = candidates.length - 1; i > 0; i--) {
    const current = candidates[i];
    const prev = candidates[i - 1];
    if (current.dir === prev.dir && severityOrder[current.grade] > severityOrder[prev.grade] && (current.distance - prev.distance) < 30) {
      prev.grade = current.grade;
      candidates.splice(i, 1);
    }
  }

  // --- Step 5: Final Formatting ---
  const directionMap = {
    'R': format === 'descriptive' ? 'Right' : 'R',
    'L': format === 'descriptive' ? 'Left' : 'L'
  };

  const finalNotes = [];
  let currentPos = 0;

  candidates.forEach(c => {
    if (c.grade === 'S') return; // Skip straight markers in final output
    
    const distToNext = Math.round((c.distance - currentPos) / 10) * 10;
    const distStr = distToNext > 10 ? `${distToNext}m: ` : '';
    const gradeStr = format === 'descriptive' ? descriptiveMap[c.grade] : c.grade;
    const dirStr = directionMap[c.dir];
    
    finalNotes.push(`${distStr}${gradeStr} ${dirStr}`);
    currentPos = c.distance;
  });

  const remainingDist = Math.round((totalLength - currentPos) / 10) * 10;
  if (remainingDist > 10) {
    finalNotes.push(`${remainingDist}m: End of section`);
  }

  return finalNotes.join('\n');
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
