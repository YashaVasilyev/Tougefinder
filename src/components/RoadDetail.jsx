import React, { useEffect, useState } from 'react';
import { X, ExternalLink, TrendingUp, ArrowUpRight, ArrowDownRight, Clock, Ruler, Info } from 'lucide-react';
import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchElevationForRoad } from '../services/elevation';

const RoadDetail = ({ road, onClose }) => {
  const [elevationData, setElevationData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadElevation = async () => {
      setLoading(true);
      const data = await fetchElevationForRoad(road.coordinates);
      setElevationData(data);
      setLoading(false);
    };
    loadElevation();
  }, [road]);

  const chartData = elevationData?.profile.map((elevation, index) => ({
    dist: index,
    elevation: elevation
  })) || [];

  const handleOpenMaps = () => {
    const [lon, lat] = road.coordinates[0];
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
    window.open(url, '_blank');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 100 }}
      className="fixed inset-x-0 bottom-0 top-[10%] md:top-auto md:bottom-6 md:left-auto md:right-6 md:w-[450px] z-[1003] glass-dark rounded-t-[40px] md:rounded-[40px] shadow-2xl overflow-hidden flex flex-col border-t border-white/20"
    >
      {/* Header */}
      <div className="p-8 pb-4 flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-bold mb-1 tracking-tight">{road.name}</h2>
          <div className="flex gap-2 items-center">
            <span className="px-3 py-1 bg-touge-600 rounded-full text-xs font-bold uppercase tracking-widest">
              Score {road.totalScore}
            </span>
            <span className="text-zinc-400 text-sm font-medium">{road.type} road</span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-3 bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-8 pt-0 space-y-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard icon={<Ruler className="text-touge-400" />} label="Length" value={`${road.lengthMiles} mi`} />
          <StatCard icon={<TrendingUp className="text-blue-400" />} label="Avg Grade" value={elevationData ? `${elevationData.avgGrade}%` : '...'} />
          <StatCard icon={<ArrowUpRight className="text-green-400" />} label="Ascent" value={elevationData ? `${elevationData.gain} ft` : '...'} />
          <StatCard icon={<Clock className="text-yellow-400" />} label="Est. Time" value="~12 min" />
        </div>

        {/* Elevation Chart */}
        <div className="space-y-4">
          <div className="flex justify-between items-end">
            <h3 className="text-lg font-bold">Elevation Profile</h3>
            <span className="text-xs text-zinc-500 font-mono">Gain: {elevationData?.gain} ft / Loss: {elevationData?.loss} ft</span>
          </div>
          <div className="h-48 w-full bg-black/40 rounded-3xl p-4 border border-white/5">
            {loading ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-touge-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorElev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f83b3b" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#f83b3b" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="elevation" stroke="#f83b3b" strokeWidth={2} fillOpacity={1} fill="url(#colorElev)" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '12px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Action Button */}
        <button 
          onClick={handleOpenMaps}
          className="w-full btn-primary flex items-center justify-center gap-3 py-5 text-lg group"
        >
          <ExternalLink className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          Navigate to Start
        </button>
      </div>
    </motion.div>
  );
};

const StatCard = ({ icon, label, value }) => (
  <div className="bg-white/5 rounded-3xl p-5 border border-white/5 flex flex-col gap-2">
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
    </div>
    <span className="text-xl font-bold tracking-tight">{value}</span>
  </div>
);

export default RoadDetail;
