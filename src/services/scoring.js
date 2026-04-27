import * as turf from '@turf/turf';

/**
 * Scoring Algorithm
 * 
 * curvature_score = total_bearing_change_degrees / length_miles → normalized 0–40 pts
 * elevation_score = (gain + loss) / length_miles → normalized 0–35 pts (placeholder for now)
 * traffic_score = score_by_osm_road_class() → 0–25 pts
 */

export const calculateScores = (roads, thresholds = {}) => {
  const {
    minScore = 30,
    minLength = 0.25,
    maxHouseDensity = 25
  } = thresholds;

  return roads.map(road => {
    // --- EXCLUSION CRITERIA ---
    // 1. Exclude if the road itself is a major thoroughfare (4+ lanes or motorway)
    const lanes = parseInt(road.tags?.lanes || '2');
    const isMajorRoad = lanes >= 4 || ['motorway', 'trunk', 'primary'].includes(road.type);
    if (isMajorRoad) return null;

    // 2. Exclude if it crosses a major 4+ lane road (Stop lights/Major junctions)
    if (road.hasMajorIntersection) return null;

    const coords = road.coordinates;
    const line = turf.lineString(coords);
    const lengthKm = turf.length(line, { units: 'kilometers' });
    const lengthMiles = lengthKm * 0.621371;

    if (lengthMiles < minLength) return null;

    // --- Sliding Window Curvature Analysis ---
    const windowSizeMiles = 0.25;
    let maxCurvatureIntensity = 0;
    const distances = [0];
    const bearings = [];
    for (let i = 0; i < coords.length - 1; i++) {
      distances.push(distances[i] + turf.distance(coords[i], coords[i + 1], { units: 'miles' }));
      bearings.push(turf.bearing(coords[i], coords[i + 1]));
    }

    const stride = coords.length > 500 ? 5 : 2;
    for (let i = 0; i < coords.length - 3; i += stride) {
      const startDist = distances[i];
      let j = i + 1;
      while (j < coords.length && (distances[j] - startDist) < windowSizeMiles) j++;
      if (j - i >= 3) {
        let windowTotalBearingChange = 0;
        for (let k = i; k < j - 2; k++) {
          let diff = Math.abs(bearings[k + 1] - bearings[k]);
          if (diff > 180) diff = 360 - diff;
          windowTotalBearingChange += diff;
        }
        const windowLength = distances[j - 1] - startDist;
        const intensity = windowTotalBearingChange / (windowLength || 0.1);
        if (intensity > maxCurvatureIntensity) maxCurvatureIntensity = intensity;
      }
    }

    // Curvature Score (60 pts)
    const curvatureScore = Math.min(60, (maxCurvatureIntensity / 1000) * 60);

    // --- HEAVY FLOW PENALTY (40 pts) ---
    // Increase sensitivity to stop signs and intersections
    // Each stop/intersection now removes ~10 points from the flow score.
    const featuresPerMile = (road.intersections + (road.stopSigns * 2)) / lengthMiles;
    const flowScore = Math.max(0, 40 - (featuresPerMile * 15));

    const totalScore = Math.round(curvatureScore + flowScore);

    if (totalScore < minScore) return null;

    return {
      ...road,
      lengthMiles: lengthMiles.toFixed(2),
      lengthKm: lengthKm.toFixed(2),
      curvatureScore: Math.round(curvatureScore),
      flowScore: Math.round(flowScore),
      totalScore,
      maxIntensity: Math.round(maxCurvatureIntensity),
      lineString: line,
      elevationScore: 0,
      trafficScore: Math.round(flowScore)
    };
  }).filter(r => r !== null).sort((a, b) => b.totalScore - a.totalScore);
};

const calculateCurvature = (coordinates) => {
  // Kept for backward compatibility but internal scoring now uses pre-calculated bearings
  let totalBearingChange = 0;
  for (let i = 0; i < coordinates.length - 2; i++) {
    const bearing1 = turf.bearing(coordinates[i], coordinates[i + 1]);
    const bearing2 = turf.bearing(coordinates[i + 1], coordinates[i + 2]);
    let diff = Math.abs(bearing2 - bearing1);
    if (diff > 180) diff = 360 - diff;
    totalBearingChange += diff;
  }
  return totalBearingChange;
};

const getTrafficScore = (type) => {
  const scores = {
    'tertiary': 25,
    'unclassified': 25,
    'residential': 15,
    'service': 10,
    'track': 20,
    'secondary': 10,
    'primary': 5,
    'motorway': 0,
    'trunk': 0
  };

  return scores[type] || 10;
};
