import { useState, useEffect, useCallback, useRef } from 'react';
import { translations, Language } from './translations';
import { usePostureTracking, PostureMetrics } from './hooks/usePostureTracking';
import { 
  Camera, 
  CameraOff, 
  Settings, 
  Maximize2, 
  Shield, 
  ShieldOff, 
  Bell, 
  Languages,
  Target,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [lang, setLang] = useState<Language>('de');
  const [sensitivity, setSensitivity] = useState(5); // 1 = tolerant, 10 = streng
  const [timer, setTimer] = useState(10);
  const [privacyBlur, setPrivacyBlur] = useState(false);
  const [metrics, setMetrics] = useState<PostureMetrics | null>(null);
  const warningStartTimeRef = useRef<number | null>(null);
  const [showCalibratedFeedback, setShowCalibratedFeedback] = useState(false);
  
  const t = translations[lang];
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleMetricsUpdate = useCallback((newMetrics: PostureMetrics) => {
    setMetrics(newMetrics);
  }, []);

  const { videoRef, canvasRef, startCamera, stopCamera, calibrate, isActive, error: cameraError, calibrationCount } = usePostureTracking({
    sensitivity,
    onMetricsUpdate: handleMetricsUpdate,
    privacyBlur,
  });

  // Calibration feedback effect
  useEffect(() => {
    if (calibrationCount > 0) {
      setShowCalibratedFeedback(true);
      const timer = setTimeout(() => setShowCalibratedFeedback(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [calibrationCount]);

  // Notification & Sound Logic
  useEffect(() => {
    if (metrics && (metrics.isWarning || metrics.isAlarm)) {
      if (warningStartTimeRef.current === null) {
        warningStartTimeRef.current = Date.now();
      } else {
        const duration = (Date.now() - warningStartTimeRef.current) / 1000;
        if (duration >= timer) {
          // Trigger Alarm
          if (Notification.permission === 'granted') {
            new Notification(t.notifications.title, {
              body: t.notifications.body,
              silent: false,
            });
          }
          // Play sound
          if (audioRef.current) {
            audioRef.current.play().catch(() => {});
          }
          // Reset timer to avoid spamming
          warningStartTimeRef.current = Date.now();
        }
      }
    } else {
      warningStartTimeRef.current = null;
    }
  }, [metrics, timer, t]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // Initialize audio
    audioRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
  }, []);

  const getStatusColor = () => {
    if (!isActive) return 'bg-gray-500';
    if (metrics?.isAlarm) return 'bg-apple-red shadow-[0_0_12px_rgba(255,59,48,0.6)] animate-pulse';
    if (metrics?.isWarning) return 'bg-apple-orange shadow-[0_0_12px_rgba(255,149,0,0.6)]';
    return 'bg-apple-green shadow-[0_0_12px_rgba(52,199,89,0.6)]';
  };

  return (
    <div className="min-h-screen flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="px-8 py-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-apple-blue rounded-xl flex items-center justify-center shadow-lg shadow-apple-blue/20">
            <Target className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-medium">{t.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setLang(lang === 'de' ? 'en' : 'de')}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <Languages className="w-5 h-5 text-white/60" />
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 glass-panel">
            <div className={`status-dot ${getStatusColor()}`} />
            <span className="text-xs font-medium text-white/80">
              {!isActive ? t.status.inactive : (metrics?.isAlarm ? t.status.alarm : (metrics?.isWarning ? t.status.warning : t.status.optimal))}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-8 pb-8 grid grid-cols-1 lg:grid-cols-4 gap-6 relative">
        {/* Video Feed Container */}
        <section className="lg:col-span-3 relative glass-panel overflow-hidden group">
          <video 
            ref={videoRef} 
            className="hidden" 
            playsInline 
            muted 
          />
          <canvas 
            ref={canvasRef} 
            className="w-full h-full object-cover"
            width={1280}
            height={720}
          />
          
          <AnimatePresence>
            {!isActive && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-20 p-8 text-center"
              >
                {cameraError ? (
                  <div className="space-y-4 max-w-md">
                    <div className="w-16 h-16 bg-apple-red/20 rounded-full flex items-center justify-center mx-auto">
                      <ShieldOff className="text-apple-red w-8 h-8" />
                    </div>
                    <p className="text-sm font-medium text-white/80">{cameraError}</p>
                    <button 
                      onClick={startCamera}
                      className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-semibold transition-all"
                    >
                      Erneut versuchen
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={startCamera}
                    className="px-8 py-4 bg-apple-blue hover:bg-apple-blue/90 text-white rounded-2xl font-semibold flex items-center gap-3 transition-all transform hover:scale-105 active:scale-95 shadow-2xl shadow-apple-blue/30"
                  >
                    <Camera className="w-6 h-6" />
                    {t.startCamera}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Overlay Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 glass-panel z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <button 
              onClick={() => setPrivacyBlur(!privacyBlur)}
              className={`p-2 rounded-xl transition-colors ${privacyBlur ? 'bg-apple-blue text-white' : 'hover:bg-white/10 text-white/60'}`}
              title={t.privacyBlur}
            >
              {privacyBlur ? <ShieldOff className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </button>
            <div className="w-px h-6 bg-white/10" />
            <button 
              onClick={calibrate}
              disabled={!isActive}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 ${
                showCalibratedFeedback 
                  ? 'bg-apple-green text-white shadow-lg shadow-apple-green/20' 
                  : 'hover:bg-white/10 text-white/80'
              }`}
            >
              {showCalibratedFeedback ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Kalibriert
                </>
              ) : (
                <>
                  <Target className="w-4 h-4" />
                  {t.calibrate}
                </>
              )}
            </button>
            <div className="w-px h-6 bg-white/10" />
            <button 
              onClick={stopCamera}
              className="p-2 hover:bg-apple-red/20 text-apple-red rounded-xl transition-colors"
            >
              <CameraOff className="w-5 h-5" />
            </button>
          </div>
        </section>

        {/* Sidebar Controls */}
        <aside className="space-y-6">
          <div className="glass-panel p-6 space-y-6">
            <div className="flex items-center gap-2 text-white/40">
              <Settings className="w-4 h-4" />
              <h2 className="text-[10px] uppercase tracking-widest font-bold">{t.sensitivity}</h2>
            </div>
            
            <div className={`space-y-4 ${!isActive ? 'opacity-60' : ''}`}>
              <input 
                type="range" 
                min="1" 
                max="10" 
                step="1"
                value={sensitivity}
                disabled={!isActive}
                onChange={(e) => setSensitivity(parseInt(e.target.value))}
                className="w-full accent-apple-blue bg-white/10 h-1 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
              />
              <div className="flex justify-between text-[10px] text-white/40 font-medium">
                <span>{t.sensitivityLow}</span>
                <span className="text-apple-blue">{sensitivity}</span>
                <span>{t.sensitivityHigh}</span>
              </div>
              {!isActive && (
                <p className="text-[10px] text-white/30 italic">{t.sensitivityOnlyWhenActive}</p>
              )}
            </div>

            <div className="pt-4 border-t border-white/5 space-y-4">
              <div className="flex items-center gap-2 text-white/40">
                <Bell className="w-4 h-4" />
                <h2 className="text-[10px] uppercase tracking-widest font-bold">{t.timer}</h2>
              </div>
              
              <div className="segmented-control">
                {[5, 10, 30, 60].map((val) => (
                  <button
                    key={val}
                    onClick={() => setTimer(val)}
                    className={`segmented-item ${timer === val ? 'segmented-item-active' : 'text-white/40 hover:text-white/60'}`}
                  >
                    {val}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Metrics Visualization */}
          <div className="glass-panel p-6 space-y-4">
             <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">Live Metrics</h2>
             <div className="space-y-3">
                <MetricRow label="Neck Angle" value={`${metrics?.neckAngle.toFixed(0) || 0}°`} active={metrics?.isWarning} />
                <MetricRow label="Z-Distance" value={`${(metrics?.screenDistance || 0).toFixed(2)}`} active={metrics?.isAlarm} />
                <MetricRow label="Slouch" value={`${(metrics?.slouchFactor || 0).toFixed(2)}`} active={metrics?.isWarning} />
             </div>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="px-8 py-6 text-center border-t border-white/5">
        <p className="text-[10px] text-white/20 font-medium tracking-wide uppercase">{t.footer}</p>
      </footer>
    </div>
  );
}

function MetricRow({ label, value, active }: { label: string, value: string, active?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-white/60">{label}</span>
      <span className={`text-xs font-mono font-medium ${active ? 'text-apple-red' : 'text-white/80'}`}>{value}</span>
    </div>
  );
}
