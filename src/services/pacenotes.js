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
  const { reverse = false, format = 'rally', elevationProfile = null } = options;
  let coords = reverse ? [...coordinates].reverse() : coordinates;
  
  if (coords.length < 3) return "Road too short for pacenotes.";

  // --- Step 1: Pre-smoothing ---
  const rawLine = turf.lineString(coords);
  const smoothedLine = turf.bezierSpline(rawLine, { resolution: 10000, sharpness: 0.85 });

  // --- Step 1.5: Resample the road to consistent 5m segments ---
  const totalLength = turf.length(smoothedLine, { units: 'meters' });
  const stepSize = 5; 
  const points = [];
  for (let d = 0; d <= totalLength; d += stepSize) {
    points.push(turf.along(smoothedLine, d, { units: 'meters' }).geometry.coordinates);
  }
  if (totalLength % stepSize !== 0) {
    points.push(turf.along(smoothedLine, totalLength, { units: 'meters' }).geometry.coordinates);
  }

  // --- Map Elevation Data (Feature 5) ---
  const elevationFeatures = [];
  if (elevationProfile && elevationProfile.length >= 3) {
    let profile = reverse ? [...elevationProfile].reverse() : elevationProfile;
    const profileStepDist = totalLength / (profile.length - 1);
    
    for (let i = 1; i < profile.length - 1; i++) {
      const prev = profile[i - 1];
      const curr = profile[i];
      const next = profile[i + 1];
      
      // Require at least a 2m peak/drop to consider it a crest/dip
      const isCrest = curr > prev && curr > next && (curr - Math.min(prev, next) > 2);
      const isDip = curr < prev && curr < next && (Math.max(prev, next) - curr > 2);
      
      if (isCrest) elevationFeatures.push({ type: 'crest', distance: i * profileStepDist });
      if (isDip) elevationFeatures.push({ type: 'dip', distance: i * profileStepDist });
    }
  }

  const descriptiveMap = {
    'HP': 'Hairpin',
    '1': 'Sharp',
    '2': 'Sharp',
    '3': 'Tight',
    '4': 'Tight',
    '5': 'Moderate',
    'S': 'Straight'
  };

  const severityOrder = { 'S': 0, '5': 1, '4': 2, '3': 3, '2': 4, '1': 5, 'HP': 6 };

  // --- Step 2: Initial Point-by-Point Classification ---
  const lookDistance = 2; // 10m spacing for reactivity
  let rawCandidates = [];

  for (let i = lookDistance; i < points.length - lookDistance; i++) {
    const pPrev = points[i - lookDistance];
    const pCurr = points[i];
    const pNext = points[i + lookDistance];
    
    const radius = calculateRadius(pPrev, pCurr, pNext);
    
    const b1 = turf.bearing(pPrev, pCurr);
    const b2 = turf.bearing(pCurr, pNext);
    let diff = b2 - b1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    const absDiff = Math.abs(diff);

    let grade = 'S';
    if (absDiff > 150 && radius < 30) grade = 'HP';
    else if (radius < 20) grade = '1';
    else if (radius < 50) grade = '3';
    else if (radius < 150) grade = '5';

    const dir = diff > 0 ? 'R' : 'L';
    
    rawCandidates.push({
      index: i,
      grade,
      dir: grade === 'S' ? null : dir,
      distance: i * stepSize,
      radius
    });
  }

  // --- Step 3: Identify Turn Sequences ---
  let turns = [];
  let currentTurn = null;

  for (let i = 0; i < rawCandidates.length; i++) {
    const pt = rawCandidates[i];
    if (pt.grade !== 'S') {
      if (!currentTurn) {
        currentTurn = { startDist: pt.distance, endDist: pt.distance, dir: pt.dir, grades: [pt.grade], tightestGrade: pt.grade };
      } else if (currentTurn.dir === pt.dir && (pt.distance - currentTurn.endDist) <= 15) { 
        currentTurn.endDist = pt.distance;
        currentTurn.grades.push(pt.grade);
        if (severityOrder[pt.grade] > severityOrder[currentTurn.tightestGrade]) {
          currentTurn.tightestGrade = pt.grade;
        }
      } else { 
        turns.push(currentTurn);
        currentTurn = { startDist: pt.distance, endDist: pt.distance, dir: pt.dir, grades: [pt.grade], tightestGrade: pt.grade };
      }
    } else {
      if (currentTurn && (pt.distance - currentTurn.endDist) > 15) {
        turns.push(currentTurn);
        currentTurn = null;
      }
    }
  }
  if (currentTurn) turns.push(currentTurn);

  // --- Step 4: Post-Process Turns (Length, Tightens/Opens) ---
  turns.forEach(t => {
    t.length = t.endDist - t.startDist;
    t.isLong = t.length >= 40 && t.length < 80;
    t.isVeryLong = t.length >= 80;

    const firstGrade = t.grades[0];
    const lastGrade = t.grades[t.grades.length - 1];
    
    if (severityOrder[t.tightestGrade] > severityOrder[firstGrade]) t.tightens = true;
    if (severityOrder[lastGrade] < severityOrder[t.tightestGrade] && lastGrade !== t.tightestGrade) t.opens = true;
  });

  turns = turns.filter(t => t.length >= 10 || severityOrder[t.tightestGrade] >= 3);

  // --- Step 5: Final Formatting and Connectors ---
  const directionMap = {
    'R': format === 'descriptive' ? 'Right' : 'R',
    'L': format === 'descriptive' ? 'Left' : 'L'
  };

  const finalNotes = [];

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    
    let prefix = '';
    if (i > 0) {
      const distFromPrev = t.startDist - turns[i-1].endDist;
      if (distFromPrev < 20) {
        prefix = 'into ';
      } else if (distFromPrev < 50) {
        prefix = 'and ';
      } else {
        const distToNext = Math.round(distFromPrev / 10) * 10;
        if (distToNext > 10) prefix = `${distToNext}m: `;
      }
    } else {
      const distToNext = Math.round(t.startDist / 10) * 10;
      if (distToNext > 10) prefix = `${distToNext}m: `;
    }

    const gradeStr = format === 'descriptive' ? descriptiveMap[t.tightestGrade] : t.tightestGrade;
    const dirStr = directionMap[t.dir];
    
    let suffix = '';
    if (t.isVeryLong) suffix += ' very long';
    else if (t.isLong) suffix += ' long';

    if (t.tightens && t.opens) suffix += ' tightens then opens';
    else if (t.tightens) suffix += ' tightens';
    else if (t.opens) suffix += ' opens';

    // Elevation features
    const nearbyElevation = elevationFeatures.find(f => Math.abs(f.distance - t.startDist) < 30);
    if (nearbyElevation) {
      if (nearbyElevation.type === 'crest') suffix += ' over crest';
      else if (nearbyElevation.type === 'dip') suffix += ' dip';
    }

    finalNotes.push(`${prefix}${gradeStr} ${dirStr}${suffix}`);
  }

  const lastEndDist = turns.length > 0 ? turns[turns.length - 1].endDist : 0;
  const remainingDist = Math.round((totalLength - lastEndDist) / 10) * 10;
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
