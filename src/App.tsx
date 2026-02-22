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
  CheckCircle2,
  StopCircle,
  Moon,
  Sun,
  Github,
  Twitter,
  Linkedin,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [lang, setLang] = useState<Language>('en');
  const [sensitivity, setSensitivity] = useState(5); // 1 = tolerant, 10 = streng
  const [timer, setTimer] = useState(30);
  const [alarmSoundIndex, setAlarmSoundIndex] = useState(0);
  const [privacyBlur, setPrivacyBlur] = useState(false);
  const [metrics, setMetrics] = useState<PostureMetrics | null>(null);
  const warningStartTimeRef = useRef<number | null>(null);
  const NOTIFICATION_COOLDOWN_MS = 1 * 60 * 60 * 1000; // max. 1 Systemmeldung pro Stunde
  const NOTIFICATION_STORAGE_KEY = 'backwatch_last_system_notification';
  const [showCalibratedFeedback, setShowCalibratedFeedback] = useState(false);
  const [showStartupCalibrationHint, setShowStartupCalibrationHint] = useState(true);
  const [showCalibrateReminder, setShowCalibrateReminder] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [skeletonColor, setSkeletonColor] = useState<'blue' | 'lightblue' | 'white'>('blue');
  
  const t = translations[lang];
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const ALARM_SOUNDS = [
    { url: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3', labelKey: 'alarmSoundDefault' as const },
    { url: 'https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3', labelKey: 'alarmSoundSignal' as const },
    { url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3', labelKey: 'alarmSoundClassic' as const },
  ];

  const handleMetricsUpdate = useCallback((newMetrics: PostureMetrics) => {
    setMetrics(newMetrics);
  }, []);

  const SKELETON_COLORS = {
    blue:      '#0A84FF',
    lightblue: '#50D2E8',
    white:     '#FFFFFF',
  };

  const { videoRef, canvasRef, startCamera, stopCamera, calibrate, isActive, error: cameraError, calibrationCount } = usePostureTracking({
    sensitivity,
    onMetricsUpdate: handleMetricsUpdate,
    privacyBlur,
    skeletonColor: SKELETON_COLORS[skeletonColor],
    getErrorMessages: () => ({ cameraInUse: t.cameraInUse, cameraError: t.cameraError }),
  });

  // Calibration feedback effect
  useEffect(() => {
    if (calibrationCount > 0) {
      setShowCalibratedFeedback(true);
      setShowCalibrateReminder(false);
      const timer = setTimeout(() => setShowCalibratedFeedback(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [calibrationCount]);

  const calibrationCountRef = useRef(calibrationCount);
  calibrationCountRef.current = calibrationCount;

  // Nach 10 Sekunden: Hinweis „Bitte Haltung kalibrieren“, wenn noch nicht kalibriert
  useEffect(() => {
    if (!isActive) {
      setShowCalibrateReminder(false);
      return;
    }
    const id = setTimeout(() => {
      if (calibrationCountRef.current === 0) setShowCalibrateReminder(true);
    }, 10000);
    return () => clearTimeout(id);
  }, [isActive]);

  // Notification & Sound Logic (nur wenn Person sichtbar und am Platz)
  useEffect(() => {
    if (metrics?.personVisible !== true) {
      warningStartTimeRef.current = null;
      return;
    }
    if (metrics && (metrics.isWarning || metrics.isAlarm)) {
      if (warningStartTimeRef.current === null) {
        warningStartTimeRef.current = Date.now();
      } else {
        const duration = (Date.now() - warningStartTimeRef.current) / 1000;
        if (duration >= timer) {
          // Trigger Alarm
          const now = Date.now();
          const lastSaved = parseInt(localStorage.getItem(NOTIFICATION_STORAGE_KEY) ?? '0', 10);
          if (Notification.permission === 'granted' && (now - lastSaved >= NOTIFICATION_COOLDOWN_MS)) {
            new Notification(t.notifications.title, {
              body: t.notifications.body,
              silent: false,
            });
            localStorage.setItem(NOTIFICATION_STORAGE_KEY, String(now));
          }
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
  }, []);

  useEffect(() => {
    audioRef.current = new Audio(ALARM_SOUNDS[alarmSoundIndex].url);
  }, [alarmSoundIndex]);

  const getStatusColor = () => {
    if (!isActive) return 'bg-gray-500';
    if (metrics?.personVisible === false) return 'bg-gray-500';
    if (metrics?.isAlarm) return 'bg-apple-red shadow-[0_0_12px_rgba(255,59,48,0.6)] animate-pulse';
    if (metrics?.isWarning) return 'bg-apple-orange shadow-[0_0_12px_rgba(255,149,0,0.6)]';
    return 'bg-apple-green shadow-[0_0_12px_rgba(52,199,89,0.6)]';
  };

  return (
    <div className="min-h-screen flex flex-col font-sans overflow-hidden app-theme" data-theme={theme}>
      {/* Start-Hinweis: Kalibrierung (jedes Mal beim Neustart) */}
      <AnimatePresence>
        {showStartupCalibrationHint && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowStartupCalibrationHint(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel p-6 max-w-md text-center space-y-4"
            >
              <p className="text-sm text-white/90 leading-relaxed">
                {t.startupCalibrationMessage}
              </p>
              <button
                onClick={() => setShowStartupCalibrationHint(false)}
                className="px-6 py-2.5 bg-apple-blue hover:bg-apple-blue/90 text-white rounded-xl font-semibold text-sm transition-colors"
              >
                {t.ok}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="px-8 py-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <div className="app-logo w-10 h-10 bg-apple-blue rounded-xl flex items-center justify-center shadow-lg shadow-apple-blue/20">
            <Target className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
            <p className="text-[10px] tracking-[0.05em] text-white/40 font-medium">{t.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-full transition-colors theme-toggle"
            title={theme === 'dark' ? t.lightMode : t.darkMode}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5 text-white/60 hover:text-white" /> : <Moon className="w-5 h-5 text-gray-600 hover:text-gray-900" />}
          </button>
          <button 
            onClick={() => setLang(lang === 'de' ? 'en' : 'de')}
            title={t.switchLanguage}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <Languages className="w-5 h-5 text-white/60" />
          </button>
          <div className="flex items-center gap-3 px-5 py-2.5 glass-panel">
            <div className={`status-dot ${getStatusColor()}`} />
            <span className="text-sm font-medium text-white/80">
              {!isActive ? t.status.inactive : (metrics?.personVisible === false ? t.status.notVisible : (metrics?.isAlarm ? t.status.alarm : (metrics?.isWarning ? t.status.warning : t.status.optimal)))}
            </span>
          </div>
        </div>
      </header>

      {/* Kalibrier-Hinweis nach 10 Sekunden, wenn noch nicht kalibriert */}
      <AnimatePresence>
        {showCalibrateReminder && isActive && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-8 mt-0 mb-2 px-4 py-3 rounded-xl bg-apple-orange/20 border border-apple-orange/40 flex items-center justify-center gap-2"
          >
            <Target className="w-5 h-5 text-apple-orange shrink-0" />
            <p className="text-sm font-medium text-white/90">{t.calibrateReminder}</p>
          </motion.div>
        )}
      </AnimatePresence>

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
            width={1920}
            height={1080}
            style={{ imageRendering: 'auto' }}
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
                      {t.tryAgain}
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
              title={t.calibrateHint}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 ${
                showCalibratedFeedback 
                  ? 'bg-apple-green text-white shadow-lg shadow-apple-green/20' 
                  : 'hover:bg-white/10 text-white/80'
              }`}
            >
              {showCalibratedFeedback ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {t.calibrated}
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
              className="px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 hover:bg-apple-red/20 text-apple-red"
            >
              <StopCircle className="w-5 h-5" />
              {t.end}
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
              <div className="relative">
                <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  step="1"
                  value={sensitivity}
                  disabled={!isActive}
                  onChange={(e) => setSensitivity(parseInt(e.target.value))}
                  className="sensitivity-slider w-full accent-apple-blue bg-white/10 h-1 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                />
                <div className="absolute top-full left-0 w-full mt-1 h-[1em] pointer-events-none">
                  <span 
                    className="absolute text-apple-blue text-[10px] font-medium -translate-x-1/2"
                    style={{ left: `${((sensitivity - 1) / 9) * 100}%` }}
                  >
                    {sensitivity}
                  </span>
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-white/40 font-medium">
                <span>{t.sensitivityLow}</span>
                <span>{t.sensitivityHigh}</span>
              </div>
              {!isActive && (
                <p className="text-[10px] text-white/30 italic">{t.sensitivityOnlyWhenActive}</p>
              )}
            </div>

            {isActive && (
              <div className="pt-4 border-t border-white/5">
                <p className="text-[11px] text-white/50 leading-relaxed">{t.calibrateHint}</p>
              </div>
            )}
            <div className="pt-4 border-t border-white/5 space-y-4">
              <div className="flex items-center gap-2 text-white/40">
                <Bell className="w-4 h-4" />
                <h2 className="text-[10px] uppercase tracking-widest font-bold">{t.timer}</h2>
              </div>
              <div className="grid grid-cols-5 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/5">
                {[5, 10, 15, 20, 30, 45, 60, 120, 180, 300].map((val) => (
                  <button
                    key={val}
                    onClick={() => setTimer(val)}
                    className={`min-h-[36px] rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-center ${
                      timer === val
                        ? 'bg-white/15 text-white shadow-sm'
                        : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {val < 60 ? `${val}s` : `${val / 60}min`}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-white/5 space-y-3">
              <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">{t.skeletonColor}</h2>
              <div className="flex gap-2">
                {([
                  { key: 'blue',      hex: '#0A84FF' },
                  { key: 'lightblue', hex: '#50D2E8' },
                  { key: 'white',     hex: '#FFFFFF'  },
                ] as const).map(({ key, hex }) => (
                  <button
                    key={key}
                    onClick={() => setSkeletonColor(key)}
                    title={t[`skeletonColor${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof typeof t] as string}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      skeletonColor === key ? 'border-white/70 scale-110' : 'border-white/20 hover:border-white/40'
                    }`}
                    style={{
                      background: hex,
                      boxShadow: key === 'white' ? 'inset 0 0 0 1.5px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.12)' : undefined,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-white/5 space-y-3">
              <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">{t.alarmSound}</h2>
              <div className="flex flex-wrap gap-2">
                {ALARM_SOUNDS.map((sound, idx) => (
                  <button
                    key={idx}
                    onClick={() => setAlarmSoundIndex(idx)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      alarmSoundIndex === idx ? 'bg-apple-blue text-white' : 'bg-white/10 text-white/60 hover:text-white/80'
                    }`}
                  >
                    {t[sound.labelKey]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Metrics Visualization (nur wenn Person sichtbar) */}
          <div className="glass-panel p-6 space-y-4">
             <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">{t.liveMetrics}</h2>
             {metrics?.personVisible === false ? (
               <p className="text-xs text-white/40">{t.status.notVisible}</p>
             ) : (
               <div className="space-y-3">
                 <MetricRow label={t.neckAngle} value={`${metrics?.neckAngle != null ? metrics.neckAngle.toFixed(0) : '—'}°`} active={metrics?.isWarning} />
                 <MetricRow label={t.zDistance} value={metrics?.screenDistance != null ? (metrics.screenDistance).toFixed(2) : '—'} active={metrics?.isAlarm} />
                 <MetricRow label={t.slouch} value={metrics?.slouchFactor != null ? (metrics.slouchFactor).toFixed(2) : '—'} active={metrics?.isWarning} />
               </div>
             )}
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="px-8 py-6 border-t border-white/5 space-y-4">
        {/* Privacy Badge */}
        <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-apple-green/10 border border-apple-green/20 mx-auto max-w-md">
          <Lock className="w-3 h-3 text-apple-green shrink-0" />
          <p className="text-[10px] text-apple-green/80 font-medium">{t.footerPrivacy}</p>
        </div>

        {/* Slogan + Disclaimer */}
        <div className="text-center space-y-1">
          <p className="text-[10px] text-white/40 font-medium tracking-wide">{t.subtitle}</p>
          <p className="text-[10px] text-white/25 font-medium tracking-wide">{t.footerDisclaimer}</p>
        </div>

        {/* Social + Legal */}
        <div className="flex items-center justify-between">
          {/* Social Media Icons */}
          <div className="flex items-center gap-3">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-white/20 hover:text-white/50 transition-colors" title="GitHub">
              <Github className="w-4 h-4" />
            </a>
            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-white/20 hover:text-white/50 transition-colors" title="X / Twitter">
              <Twitter className="w-4 h-4" />
            </a>
            <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="text-white/20 hover:text-white/50 transition-colors" title="LinkedIn">
              <Linkedin className="w-4 h-4" />
            </a>
          </div>

          {/* Legal Links */}
          <div className="flex items-center gap-4">
            <a href="/impressum" className="text-[10px] text-white/20 hover:text-white/50 transition-colors font-medium">{t.footerImpressum}</a>
            <a href="/datenschutz" className="text-[10px] text-white/20 hover:text-white/50 transition-colors font-medium">{t.footerDatenschutz}</a>
          </div>
        </div>

        {/* Brand */}
        <p className="text-center text-[10px] text-white/15 font-medium tracking-wide uppercase">{t.footer}</p>
      </footer>
    </div>
  );
}

function MetricRow({ label, value, active }: { label: string, value: string, active?: boolean }) {
  const colorClass = active ? 'text-apple-red' : 'text-apple-green';
  return (
    <div className="flex justify-between items-center">
      <span className={`text-xs ${colorClass}`}>{label}</span>
      <span className={`text-xs font-mono font-medium ${colorClass}`}>{value}</span>
    </div>
  );
}
