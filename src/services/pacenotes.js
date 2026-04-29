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

const chaikinSmooth = (coords, iterations = 2) => {
  if (coords.length < 3) return coords;
  let current = [...coords];
  for (let iter = 0; iter < iterations; iter++) {
    const next = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];
      next.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25]);
      next.push([p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
};

export const generatePacenotes = (coordinates, options = {}) => {
  const { reverse = false, format = 'rally', elevationProfile = null } = options;
  let coords = reverse ? [...coordinates].reverse() : coordinates;
  
  if (coords.length < 3) return "Road too short for pacenotes.";

  // --- Step 1: Pre-smoothing ---
  const smoothedCoords = chaikinSmooth(coords, 2);
  const smoothedLine = turf.lineString(smoothedCoords);

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
      
      const isCrest = curr > prev && curr > next && (curr - Math.min(prev, next) > 2);
      const isDip = curr < prev && curr < next && (Math.max(prev, next) - curr > 2);
      
      if (isCrest) elevationFeatures.push({ type: 'crest', distance: i * profileStepDist });
      if (isDip) elevationFeatures.push({ type: 'dip', distance: i * profileStepDist });
    }
  }

  const descriptiveMap = {
    'HP': 'Hairpin',
    'Square': 'Square',
    '1': 'Sharp',
    '2': 'Sharp',
    '3': 'Tight',
    '4': 'Tight',
    '5': 'Moderate',
    '6': 'Slight',
    'S': 'Straight'
  };

  const severityOrder = { 'S': 0, '6': 1, '5': 2, '4': 3, '3': 4, '2': 5, '1': 6, 'Square': 7, 'HP': 8 };

  // --- Step 2: Initial Point-by-Point Classification ---
  const lookDistance = 2; // 10m spacing
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
    // Removed point-level HP detection to prevent premature splitting, handled in Step 4
    if (radius < 20) grade = '1';
    else if (radius < 50) grade = '3';
    else if (radius < 80) grade = '5';
    else if (radius < 150) grade = '6';

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
      } else if (currentTurn.dir === pt.dir && (pt.distance - currentTurn.endDist) <= 20) { 
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
      if (currentTurn && (pt.distance - currentTurn.endDist) > 20) {
        turns.push(currentTurn);
        currentTurn = null;
      }
    }
  }
  if (currentTurn) turns.push(currentTurn);

  // --- Step 4: Post-Process Turns (Hairpins, Length, Tightens/Opens) ---
  turns.forEach(t => {
    t.length = t.endDist - t.startDist;
    t.isLong = t.length >= 40 && t.length < 80;
    t.isVeryLong = t.length >= 80;

    // Hairpin detection across the entire complex
    const startIndex = Math.round(t.startDist / stepSize);
    const endIndex = Math.round(t.endDist / stepSize);
    
    const entryP1 = points[Math.max(0, startIndex - 3)]; // 15m before
    const entryP2 = points[startIndex];
    const exitP1 = points[endIndex];
    const exitP2 = points[Math.min(points.length - 1, endIndex + 3)]; // 15m after
    
    if (entryP1 && exitP2) {
      const bearingIn = turf.bearing(entryP1, entryP2);
      const bearingOut = turf.bearing(exitP1, exitP2);
      let totalDiff = bearingOut - bearingIn;
      if (totalDiff > 180) totalDiff -= 360;
      if (totalDiff < -180) totalDiff += 360;
      
      // If bearing changes > 130° and radius was sharp/tight, upgrade to Hairpin
      if (Math.abs(totalDiff) > 130 && severityOrder[t.tightestGrade] >= severityOrder['3']) {
        t.tightestGrade = 'HP';
        t.grades = t.grades.map(() => 'HP'); // suppress tightens/opens for HP
      } 
      // If bearing changes ~90° and it is a 1-grade turn, upgrade to Square
      else if (Math.abs(totalDiff) >= 70 && Math.abs(totalDiff) <= 115 && t.tightestGrade === '1') {
        t.tightestGrade = 'Square';
        t.grades = t.grades.map(() => 'Square');
      }
    }

    const firstGrade = t.grades[0];
    const lastGrade = t.grades[t.grades.length - 1];
  });

  turns = turns.filter(t => t.length >= 10 || severityOrder[t.tightestGrade] >= severityOrder['3']);

  // --- Step 5: Final Formatting and Connectors ---
  const directionMap = {
    'R': format === 'descriptive' ? 'Right' : 'R',
    'L': format === 'descriptive' ? 'Left' : 'L'
  };

  const finalNotes = [];
  const finalTurns = [];

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

    // Elevation features
    const nearbyElevation = elevationFeatures.find(f => Math.abs(f.distance - t.startDist) < 30);
    if (nearbyElevation) {
      if (nearbyElevation.type === 'crest') suffix += ' over crest';
      else if (nearbyElevation.type === 'dip') suffix += ' dip';
    }

    const turnText = `${gradeStr} ${dirStr}${suffix}`;
    finalNotes.push(`${prefix}${turnText}`);

    // Place the marker at the apex of the turn instead of the start
    const apexDist = t.startDist + (t.length / 2);
    const coordIndex = Math.round(apexDist / stepSize);
    finalTurns.push({
      text: turnText,
      coordinate: points[Math.min(coordIndex, points.length - 1)]
    });
  }

  const lastEndDist = turns.length > 0 ? turns[turns.length - 1].endDist : 0;
  const remainingDist = Math.round((totalLength - lastEndDist) / 10) * 10;
  if (remainingDist > 10) {
    finalNotes.push(`${remainingDist}m: End of section`);
  }

  const textOutput = finalNotes.join('\n');
  if (options.returnObject) {
    return { text: textOutput, turns: finalTurns };
  }
  return textOutput;
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
