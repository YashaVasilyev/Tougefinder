import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Environment, Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import { fetchTerrainGrid } from '../services/elevation';
import { Loader2, X, Maximize2, Minimize2, Mountain, Play, Pause, RotateCcw, Video } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSampler(grid, minLat, maxLat, minLon, maxLon) {
  const resolution = grid.length;
  return (lat, lon) => {
    const u = (lon - minLon) / (maxLon - minLon);
    const v = (lat - minLat) / (maxLat - minLat);
    const col = u * (resolution - 1);
    const row = v * (resolution - 1);
    const col0 = Math.max(0, Math.min(resolution - 2, Math.floor(col)));
    const row0 = Math.max(0, Math.min(resolution - 2, Math.floor(row)));
    const fc = col - col0, fr = row - row0;
    return grid[row0][col0] * (1-fr)*(1-fc) + grid[row0][col0+1] * (1-fr)*fc
         + grid[row0+1][col0] * fr*(1-fc)   + grid[row0+1][col0+1] * fr*fc;
  };
}

// Haversine distance between two [lon, lat] points (returns metres)
function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function totalRoadLengthM(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i-1], coords[i]);
  return d;
}

/**
 * Returns a per-point speed multiplier array (same length as `points`).
 * Values are normalised so that the *mean* is 1.0 — meaning at 1× the
 * camera follows the route at exactly the target car speed on average,
 * while naturally slowing for turns and accelerating on straights.
 */
function computeSpeedProfile(points) {
  const n = points.length;
  if (n < 3) return new Array(n).fill(1);

  // Angular change between consecutive segments (0 = straight, π = hairpin)
  const kappa = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const v1 = new THREE.Vector3().subVectors(points[i], points[i-1]).normalize();
    const v2 = new THREE.Vector3().subVectors(points[i+1], points[i]).normalize();
    kappa[i] = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
  }
  kappa[0] = kappa[1];
  kappa[n-1] = kappa[n-2];

  // Smooth curvature with a sliding window (~5% of points each side)
  const win = Math.max(3, Math.floor(n * 0.05));
  const smooth = kappa.map((_, i) => {
    const lo = Math.max(0, i - win), hi = Math.min(n-1, i + win);
    let s = 0;
    for (let k = lo; k <= hi; k++) s += kappa[k];
    return s / (hi - lo + 1);
  });

  // Map curvature → speed multiplier (0.25 on hairpin, 1.3 on straight)
  const maxK = Math.max(...smooth, 0.001);
  const raw = smooth.map(k => {
    const t = k / maxK; // 0=straight, 1=hairpin
    return 0.25 + (1 - t) * 1.05; // range: [0.25, 1.30]
  });

  // Normalise so mean equals 1.0
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  return raw.map(v => v / mean);
}

// ─── Terrain mesh ─────────────────────────────────────────────────────────────
const TerrainMesh = ({ gridData, heightScale }) => {
  const { grid } = gridData;
  const resolution = grid.length;
  const { minE, maxE } = useMemo(() => {
    const flat = grid.flat();
    return { minE: Math.min(...flat), maxE: Math.max(...flat) };
  }, [grid]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(100, 100, resolution-1, resolution-1);
    const verts = geo.attributes.position.array;
    const range = maxE - minE || 100;
    for (let i = 0; i < resolution; i++)
      for (let j = 0; j < resolution; j++)
        verts[(i*resolution+j)*3+2] = ((grid[i][j]-minE)/range) * heightScale;
    geo.computeVertexNormals();
    geo.attributes.position.needsUpdate = true;
    return geo;
  }, [grid, resolution, minE, maxE, heightScale]);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI/2, 0, 0]} receiveShadow>
      <meshStandardMaterial color="#2d2d35" roughness={0.8} metalness={0.05} flatShading={false} />
      <gridHelper args={[100, 20, '#2a2a35', '#1a1a22']} rotation={[Math.PI/2, 0, 0]} position={[0, 0, 0.01]} />
    </mesh>
  );
};

// ─── Road line ────────────────────────────────────────────────────────────────
const RoadLine = ({ roadCoords, gridData, heightScale, onPoints }) => {
  const { grid, minLat, maxLat, minLon, maxLon } = gridData;
  const minE = useMemo(() => Math.min(...grid.flat()), [grid]);
  const maxE = useMemo(() => Math.max(...grid.flat()), [grid]);
  const range = maxE - minE || 100;
  const sampleGrid = useMemo(() => makeSampler(grid, minLat, maxLat, minLon, maxLon), [grid, minLat, maxLat, minLon, maxLon]);

  const points = useMemo(() => roadCoords.map(c => {
    const x = ((c[0]-minLon)/(maxLon-minLon))*100 - 50;
    const z = ((c[1]-minLat)/(maxLat-minLat))*100 - 50;
    const y = ((sampleGrid(c[1],c[0])-minE)/range)*heightScale + 0.6;
    return new THREE.Vector3(x, y, z);
  }), [roadCoords, minLat, maxLat, minLon, maxLon, minE, range, heightScale, sampleGrid]);

  useEffect(() => { if (onPoints) onPoints(points); }, [points, onPoints]);

  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);
  const tubeGeo = useMemo(() => new THREE.TubeGeometry(curve, 200, 0.35, 8, false), [curve]);

  return (
    <mesh geometry={tubeGeo}>
      <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={2} toneMapped={false} />
    </mesh>
  );
};

// ─── Flyover camera ───────────────────────────────────────────────────────────
const FlyoverCamera = ({ roadPoints, progress }) => {
  const { camera } = useThree();
  useEffect(() => {
    if (!roadPoints || roadPoints.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(roadPoints);
    const t = Math.min(progress, 0.9999);
    const tLook = Math.min(t + 0.025, 0.9999);
    const pos = curve.getPointAt(t);
    const look = curve.getPointAt(tLook);
    camera.position.set(pos.x, pos.y + 5, pos.z);
    camera.lookAt(look.x, look.y + 2.5, look.z);
  }, [progress, roadPoints, camera]);
  return null;
};

// ─── Main component ───────────────────────────────────────────────────────────
// Average car speed on a touge road (m/s). 1× corresponds to this.
const CAR_SPEED_MS = 50000 / 3600; // 50 km/h ≈ 13.9 m/s

const Terrain3D = ({ road, onClose }) => {
  const [gridData, setGridData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [heightScale, setHeightScale] = useState(30);
  const [roadPoints, setRoadPoints] = useState(null);

  // Flyover
  const [flyoverActive, setFlyoverActive] = useState(false);
  const [flyoverPlaying, setFlyoverPlaying] = useState(false);
  const [flyoverProgress, setFlyoverProgress] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1); // 1× = car speed

  // Derived from road geometry
  const [speedProfile, setSpeedProfile] = useState(null);
  const [baseProgressPerMs, setBaseProgressPerMs] = useState(null); // at 1× before curvature

  const animRef = useRef(null);
  const lastTimeRef = useRef(null);

  // Compute road length and base speed once road coords known
  useEffect(() => {
    if (!road?.coordinates?.length) return;
    const lenM = totalRoadLengthM(road.coordinates);
    const durationMs = (lenM / CAR_SPEED_MS) * 1000; // ms to traverse at 1×
    setBaseProgressPerMs(1 / durationMs);
  }, [road]);

  // Compute speed profile once 3D points are available
  useEffect(() => {
    if (!roadPoints) return;
    setSpeedProfile(computeSpeedProfile(roadPoints));
  }, [roadPoints]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = await fetchTerrainGrid(road.coordinates);
      setGridData(data);
      setLoading(false);
    };
    loadData();
  }, [road]);

  // Animation loop
  useEffect(() => {
    if (!flyoverPlaying || !baseProgressPerMs || !speedProfile) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      lastTimeRef.current = null;
      return;
    }

    const tick = (now) => {
      if (lastTimeRef.current !== null) {
        const dt = now - lastTimeRef.current;
        setFlyoverProgress(p => {
          if (p >= 1) { setFlyoverPlaying(false); return 1; }
          const idx = Math.min(Math.floor(p * (speedProfile.length - 1)), speedProfile.length - 1);
          const localMult = speedProfile[idx];
          return Math.min(1, p + baseProgressPerMs * speedMultiplier * localMult * dt);
        });
      }
      lastTimeRef.current = now;
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [flyoverPlaying, baseProgressPerMs, speedProfile, speedMultiplier]);

  const startFlyover = useCallback(() => {
    setFlyoverProgress(0);
    setFlyoverActive(true);
    setFlyoverPlaying(true);
  }, []);

  const resetFlyover = useCallback(() => {
    setFlyoverPlaying(false);
    setFlyoverProgress(0);
    setFlyoverActive(false);
  }, []);

  // Compute current speed label for display
  const currentLocalMult = speedProfile
    ? speedProfile[Math.min(Math.floor(flyoverProgress * (speedProfile.length-1)), speedProfile.length-1)]
    : 1;
  const displaySpeedKmh = Math.round(CAR_SPEED_MS * speedMultiplier * currentLocalMult * 3.6);

  return (
    <div className={cn(
      "fixed z-[2000] bg-zinc-950/95 backdrop-blur-3xl border border-white/10 shadow-2xl transition-all duration-500 overflow-hidden rounded-3xl",
      isFullscreen ? "inset-4" : "bottom-6 right-6 w-[480px] h-[480px]"
    )}>
      {/* Header */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-touge-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
            {flyoverActive ? '⬤ FLYOVER' : '3D Terrain Scan'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!flyoverActive ? (
            <button
              onClick={startFlyover}
              disabled={!roadPoints || !speedProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-touge-500/20 border border-touge-500/40 text-touge-400 hover:bg-touge-500 hover:text-white transition-all disabled:opacity-30"
            >
              <Video size={12} /> Flyover
            </button>
          ) : (
            <>
              <button onClick={() => setFlyoverPlaying(p => !p)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white">
                {flyoverPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button onClick={resetFlyover} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white">
                <RotateCcw size={14} />
              </button>
            </>
          )}
          <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 text-touge-500 animate-spin" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Processing Mesh...</span>
        </div>
      ) : (
        <div className="w-full h-full">
          <Canvas shadows gl={{ antialias: true }}>
            {!flyoverActive && <PerspectiveCamera makeDefault position={[80, 80, 80]} fov={45} />}
            {flyoverActive  && <PerspectiveCamera makeDefault fov={75} near={0.1} far={1000} />}

            {!flyoverActive && (
              <OrbitControls enableDamping dampingFactor={0.05} maxPolarAngle={Math.PI/2.1} minDistance={10} maxDistance={500} />
            )}
            {flyoverActive && roadPoints && (
              <FlyoverCamera roadPoints={roadPoints} progress={flyoverProgress} />
            )}

            <Stars radius={300} depth={60} count={10000} factor={7} saturation={0} fade speed={1} />
            <color attach="background" args={['#020205']} />
            <ambientLight intensity={0.5} />
            <pointLight position={[100, 150, 100]} intensity={2} castShadow />
            <spotLight position={[-100, 100, -100]} intensity={1} />

            <TerrainMesh gridData={gridData} heightScale={heightScale} />
            <RoadLine roadCoords={road.coordinates} gridData={gridData} heightScale={heightScale} onPoints={setRoadPoints} />

            <Environment preset="city" />

            {!flyoverActive && (
              <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
                <Text position={[0, heightScale+20, 0]} rotation={[0, Math.PI, 0]} fontSize={5}
                  color="#facc15" anchorX="center" anchorY="middle" maxWidth={100} textAlign="center">
                  {road.name?.toUpperCase() || 'UNNAMED TOUGE'}
                </Text>
              </Float>
            )}
          </Canvas>

          {/* Bottom controls */}
          <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2">
            {flyoverActive && (
              <div className="p-3 bg-black/70 backdrop-blur border border-white/10 rounded-xl pointer-events-auto">
                {/* Speed readout */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">Route Progress</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-touge-400">{displaySpeedKmh} km/h</span>
                    <span className="text-[10px] font-mono text-zinc-400">{(flyoverProgress*100).toFixed(1)}%</span>
                  </div>
                </div>

                {/* Progress bar — colour shifts from green (straight) to red (turn) */}
                <div className="relative w-full h-2 bg-zinc-800 rounded-full overflow-hidden mb-3">
                  <div
                    className="absolute left-0 top-0 h-full rounded-full transition-none"
                    style={{
                      width: `${flyoverProgress*100}%`,
                      background: currentLocalMult > 0.9
                        ? '#22c55e' // green – straight
                        : currentLocalMult > 0.5
                        ? '#facc15' // yellow – moderate turn
                        : '#ef4444' // red – tight turn
                    }}
                  />
                </div>

                {/* Speed multiplier slider */}
                <div className="flex items-center justify-between">
                  <span className="text-[8px] uppercase tracking-widest text-zinc-600 whitespace-nowrap">Speed  {speedMultiplier.toFixed(2)}×</span>
                  <input
                    type="range"
                    min={0.25}
                    max={5}
                    step={0.05}
                    value={speedMultiplier}
                    onChange={e => setSpeedMultiplier(Number(e.target.value))}
                    className="flex-1 ml-3 h-1 appearance-none rounded-full cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #f97316 0%, #f97316 ${((speedMultiplier-0.25)/4.75)*100}%, #3f3f46 ${((speedMultiplier-0.25)/4.75)*100}%, #3f3f46 100%)`
                    }}
                  />
                </div>
              </div>
            )}

            {!flyoverActive && (
              <div className="flex items-end gap-3 pointer-events-none">
                <div className="p-3 bg-black/60 backdrop-blur border border-white/10 rounded-xl pointer-events-none">
                  <div className="text-[8px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Telemetry</div>
                  <div className="text-xs font-mono text-touge-400">ALT: {Math.max(...gridData.grid.flat()).toFixed(0)}m MAX</div>
                  <div className="text-xs font-mono text-zinc-400">LAT: {gridData.minLat.toFixed(4)}</div>
                </div>
                <div className="flex-1 p-3 bg-black/60 backdrop-blur border border-white/10 rounded-xl pointer-events-auto">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Mountain size={10} className="text-zinc-500" />
                      <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">Exaggeration</span>
                    </div>
                    <span className="text-[10px] font-mono text-touge-400">{heightScale}×</span>
                  </div>
                  <input
                    type="range" min={1} max={100} step={1} value={heightScale}
                    onChange={e => setHeightScale(Number(e.target.value))}
                    className="w-full h-1 appearance-none rounded-full cursor-pointer"
                    style={{ background: `linear-gradient(to right, #f97316 0%, #f97316 ${(heightScale-1)/99*100}%, #3f3f46 ${(heightScale-1)/99*100}%, #3f3f46 100%)` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Terrain3D;
