import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Environment, Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import { fetchTerrainGrid } from '../services/elevation';
import { Loader2, X, Maximize2, Minimize2, Mountain, Play, Pause, RotateCcw, Video } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ─── Shared helper: sample elevation from grid via bilinear interpolation ───
function makeSampler(grid, minLat, maxLat, minLon, maxLon) {
  const resolution = grid.length;
  return (lat, lon) => {
    const u = (lon - minLon) / (maxLon - minLon);
    const v = (lat - minLat) / (maxLat - minLat);
    const col = u * (resolution - 1);
    const row = v * (resolution - 1);
    const col0 = Math.max(0, Math.min(resolution - 2, Math.floor(col)));
    const row0 = Math.max(0, Math.min(resolution - 2, Math.floor(row)));
    const col1 = col0 + 1;
    const row1 = row0 + 1;
    const fc = col - col0, fr = row - row0;
    return grid[row0][col0] * (1 - fr) * (1 - fc) +
           grid[row0][col1] * (1 - fr) * fc +
           grid[row1][col0] * fr * (1 - fc) +
           grid[row1][col1] * fr * fc;
  };
}

// ─── Terrain mesh ────────────────────────────────────────────────────────────
const TerrainMesh = ({ gridData, heightScale }) => {
  const { grid } = gridData;
  const resolution = grid.length;
  const { minE, maxE } = useMemo(() => {
    const flat = grid.flat();
    return { minE: Math.min(...flat), maxE: Math.max(...flat) };
  }, [grid]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(100, 100, resolution - 1, resolution - 1);
    const vertices = geo.attributes.position.array;
    const range = maxE - minE || 100;
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const index = (i * resolution + j) * 3;
        vertices[index + 2] = ((grid[i][j] - minE) / range) * heightScale;
      }
    }
    geo.computeVertexNormals();
    geo.attributes.position.needsUpdate = true;
    return geo;
  }, [grid, resolution, minE, maxE, heightScale]);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial color="#2d2d35" roughness={0.8} metalness={0.05} flatShading={false} />
      <gridHelper args={[100, 20, '#2a2a35', '#1a1a22']} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.01]} />
    </mesh>
  );
};

// ─── Road line + returns 3D points for flyover ───────────────────────────────
const RoadLine = ({ roadCoords, gridData, heightScale, onPoints }) => {
  const { grid, minLat, maxLat, minLon, maxLon } = gridData;
  const minE = useMemo(() => Math.min(...grid.flat()), [grid]);
  const maxE = useMemo(() => Math.max(...grid.flat()), [grid]);
  const range = maxE - minE || 100;

  const sampleGrid = useMemo(() => makeSampler(grid, minLat, maxLat, minLon, maxLon), [grid, minLat, maxLat, minLon, maxLon]);

  const points = useMemo(() => {
    return roadCoords.map((c) => {
      const lon = c[0], lat = c[1];
      const x = ((lon - minLon) / (maxLon - minLon)) * 100 - 50;
      const z = ((lat - minLat) / (maxLat - minLat)) * 100 - 50;
      const elev = sampleGrid(lat, lon);
      const y = ((elev - minE) / range) * heightScale + 0.6;
      return new THREE.Vector3(x, y, z);
    });
  }, [roadCoords, minLat, maxLat, minLon, maxLon, minE, range, heightScale, sampleGrid]);

  // Notify parent of computed 3D points
  useEffect(() => { if (onPoints) onPoints(points); }, [points, onPoints]);

  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);
  const tubeGeometry = useMemo(() => new THREE.TubeGeometry(curve, 200, 0.35, 8, false), [curve]);

  return (
    <mesh geometry={tubeGeometry}>
      <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={2} toneMapped={false} />
    </mesh>
  );
};

// ─── Flyover camera controller ────────────────────────────────────────────────
const FlyoverCamera = ({ roadPoints, progress, heightOffset = 4, lookAhead = 0.02 }) => {
  const { camera } = useThree();

  useEffect(() => {
    if (!roadPoints || roadPoints.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(roadPoints);

    // Current camera position: slightly above the road at `progress`
    const pos = curve.getPointAt(Math.min(progress, 0.9999));
    const lookTarget = curve.getPointAt(Math.min(progress + lookAhead, 0.9999));

    camera.position.set(pos.x, pos.y + heightOffset, pos.z);
    camera.lookAt(lookTarget.x, lookTarget.y + heightOffset * 0.5, lookTarget.z);
  }, [progress, roadPoints, camera, heightOffset, lookAhead]);

  return null;
};

// ─── Main component ───────────────────────────────────────────────────────────
const Terrain3D = ({ road, onClose, elevationProfile }) => {
  const [gridData, setGridData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [heightScale, setHeightScale] = useState(30);
  const [roadPoints, setRoadPoints] = useState(null);

  // Flyover state
  const [flyoverActive, setFlyoverActive] = useState(false);
  const [flyoverPlaying, setFlyoverPlaying] = useState(false);
  const [flyoverProgress, setFlyoverProgress] = useState(0);
  const [flyoverSpeed, setFlyoverSpeed] = useState(0.0005);
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(null);

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
    if (!flyoverPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTimeRef.current = null;
      return;
    }
    const tick = (now) => {
      if (lastTimeRef.current !== null) {
        const dt = now - lastTimeRef.current;
        setFlyoverProgress(p => {
          const next = p + flyoverSpeed * dt;
          if (next >= 1) { setFlyoverPlaying(false); return 1; }
          return next;
        });
      }
      lastTimeRef.current = now;
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [flyoverPlaying, flyoverSpeed]);

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

  const progressPct = (flyoverProgress * 100).toFixed(1);

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
              disabled={!roadPoints}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-touge-500/20 border border-touge-500/40 text-touge-400 hover:bg-touge-500 hover:text-white transition-all disabled:opacity-30"
            >
              <Video size={12} />
              Flyover
            </button>
          ) : (
            <>
              <button
                onClick={() => setFlyoverPlaying(p => !p)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
              >
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
            {flyoverActive && <PerspectiveCamera makeDefault fov={75} near={0.1} far={1000} />}

            {!flyoverActive && (
              <OrbitControls
                enableDamping
                dampingFactor={0.05}
                maxPolarAngle={Math.PI / 2.1}
                minDistance={10}
                maxDistance={500}
              />
            )}

            {flyoverActive && roadPoints && (
              <FlyoverCamera roadPoints={roadPoints} progress={flyoverProgress} heightOffset={5} lookAhead={0.025} />
            )}

            <Stars radius={300} depth={60} count={10000} factor={7} saturation={0} fade speed={1} />
            <color attach="background" args={['#020205']} />
            <ambientLight intensity={0.5} />
            <pointLight position={[100, 150, 100]} intensity={2} castShadow />
            <spotLight position={[-100, 100, -100]} intensity={1} />

            <TerrainMesh gridData={gridData} heightScale={heightScale} />
            <RoadLine
              roadCoords={road.coordinates}
              gridData={gridData}
              heightScale={heightScale}
              onPoints={setRoadPoints}
            />

            <Environment preset="city" />

            {!flyoverActive && (
              <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
                <Text
                  position={[0, heightScale + 20, 0]}
                  rotation={[0, Math.PI, 0]}
                  fontSize={5}
                  color="#facc15"
                  anchorX="center"
                  anchorY="middle"
                  maxWidth={100}
                  textAlign="center"
                >
                  {road.name?.toUpperCase() || 'UNNAMED TOUGE'}
                </Text>
              </Float>
            )}
          </Canvas>

          {/* Bottom Controls */}
          <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 pointer-events-none">
            {/* Flyover progress bar */}
            {flyoverActive && (
              <div className="pointer-events-auto p-3 bg-black/70 backdrop-blur border border-white/10 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">Route Progress</span>
                  <span className="text-[10px] font-mono text-touge-400">{progressPct}%</span>
                </div>
                <div className="relative w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="absolute left-0 top-0 h-full bg-touge-500 rounded-full transition-none"
                    style={{ width: `${flyoverProgress * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[8px] uppercase tracking-widest text-zinc-600">Speed</span>
                  <input
                    type="range"
                    min={0.0001}
                    max={0.003}
                    step={0.0001}
                    value={flyoverSpeed}
                    onChange={(e) => setFlyoverSpeed(Number(e.target.value))}
                    className="w-24 h-1 appearance-none rounded-full cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #f97316 0%, #f97316 ${((flyoverSpeed - 0.0001) / 0.0029) * 100}%, #3f3f46 ${((flyoverSpeed - 0.0001) / 0.0029) * 100}%, #3f3f46 100%)`
                    }}
                  />
                </div>
              </div>
            )}

            {/* Bottom row: telemetry + height slider */}
            {!flyoverActive && (
              <div className="flex items-end gap-3">
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
                    onChange={(e) => setHeightScale(Number(e.target.value))}
                    className="w-full h-1 appearance-none rounded-full cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #f97316 0%, #f97316 ${(heightScale - 1) / 99 * 100}%, #3f3f46 ${(heightScale - 1) / 99 * 100}%, #3f3f46 100%)`
                    }}
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
