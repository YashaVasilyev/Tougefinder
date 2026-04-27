import React, { useEffect, useState } from 'react';
import { X, ExternalLink, TrendingUp, ArrowUpRight, Clock, Ruler, Clipboard, Check, ArrowRightLeft } from 'lucide-react';
import { fetchElevationForRoad } from '../services/elevation';
import { generatePacenotes, getCardinalDirection } from '../services/pacenotes';

const RoadDetail = ({ road, onClose }) => {
  const [elevationData, setElevationData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isReversed, setIsReversed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const loadElevation = async () => {
      setLoading(true);
      const data = await fetchElevationForRoad(road.coordinates);
      setElevationData(data);
      setLoading(false);
    };
    loadElevation();
  }, [road]);

  const handleOpenMaps = () => {
    const [lon, lat] = road.coordinates[0];
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    if (isIOS) {
      // iOS: open Apple Maps showing the location
      window.open(`https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(road.name)}`, '_blank');
    } else if (isAndroid) {
      // Android: open Google Maps at the location
      window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, '_blank');
    } else {
      // Desktop: open Google Maps at the location
      window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, '_blank');
    }
  };

  return (
    // Mobile: slides up from bottom covering ~33% of screen
    // Desktop: floats as a card on the bottom-right
    <div className="fixed inset-x-0 bottom-0 md:bottom-6 md:left-auto md:right-6 md:w-[420px] md:inset-x-auto z-[1003] flex flex-col"
      style={{ maxHeight: '67vh' }}
    >
      {/* Pull handle (mobile only) */}
      <div className="flex justify-center pb-2 md:hidden">
        <div className="w-10 h-1 bg-white/20 rounded-full" />
      </div>

      <div className="glass-dark rounded-t-[28px] md:rounded-[28px] shadow-2xl border border-white/10 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex justify-between items-start flex-shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <h2 className="text-xl font-bold tracking-tight truncate">{road.name}</h2>
            <div className="flex gap-2 items-center mt-1">
              <span className="px-2.5 py-0.5 bg-touge-600 rounded-full text-xs font-bold uppercase tracking-widest">
                Score {road.totalScore}
              </span>
              <span className="text-zinc-400 text-xs font-medium capitalize">{road.type}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 pb-5 space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={<Ruler className="w-4 h-4 text-touge-400" />} label="Length" value={`${road.lengthMiles} mi`} />
            <StatCard icon={<TrendingUp className="w-4 h-4 text-blue-400" />} label="Avg Grade" value={elevationData ? `${elevationData.avgGrade}%` : '—'} />
            <StatCard icon={<ArrowUpRight className="w-4 h-4 text-green-400" />} label="Ascent" value={elevationData ? `${elevationData.gain} ft` : '—'} />
            <StatCard icon={<Clock className="w-4 h-4 text-yellow-400" />} label="Curvature" value={road.maxIntensity ? `${road.maxIntensity}°/mi` : '—'} />
          </div>

          {/* Score Breakdown */}
          <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-2">
            <ScoreBar label="Curvature" value={road.curvatureScore} max={60} color="bg-red-500" />
            <ScoreBar label="Flow" value={road.flowScore} max={40} color="bg-blue-500" />
          </div>

          {/* Pacenotes Section */}
          <div className="bg-zinc-900/50 rounded-2xl p-4 border border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Pacenotes</h3>
              <button 
                onClick={() => setIsReversed(!isReversed)}
                className="flex items-center gap-1.5 text-[10px] font-bold text-touge-400 uppercase bg-touge-400/10 px-2 py-1 rounded-lg hover:bg-touge-400/20 transition-colors"
              >
                <ArrowRightLeft className="w-3 h-3" />
                {getCardinalDirection(road.coordinates[0], road.coordinates[road.coordinates.length - 1])}
                {' → '}
                {getCardinalDirection(road.coordinates[road.coordinates.length - 1], road.coordinates[0])}
                {isReversed && ' (Rev)'}
              </button>
            </div>

            <button
              onClick={() => {
                const notes = generatePacenotes(road.coordinates, isReversed);
                navigator.clipboard.writeText(notes);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-400" />
                  <span className="text-green-400">Copied to Clipboard</span>
                </>
              ) : (
                <>
                  <Clipboard className="w-4 h-4 text-zinc-400" />
                  <span>Generate & Copy Pacenotes</span>
                </>
              )}
            </button>
            <p className="text-[10px] text-zinc-500 text-center leading-relaxed italic">
              "Rally style: 1 is tight, 6 is slight. Distances in meters."
            </p>
          </div>

          {/* Navigate Button */}
          <button
            onClick={handleOpenMaps}
            className="w-full btn-primary flex items-center justify-center gap-2 py-4 text-base group"
          >
            <ExternalLink className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            Open in Maps
          </button>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value }) => (
  <div className="bg-white/5 rounded-2xl p-4 border border-white/5 flex flex-col gap-1">
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
    </div>
    <span className="text-lg font-bold tracking-tight">{value}</span>
  </div>
);

const ScoreBar = ({ label, value, max, color }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-xs text-zinc-400 font-medium">
      <span>{label}</span>
      <span>{value}/{max}</span>
    </div>
    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all duration-500`}
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  </div>
);

export default RoadDetail;
