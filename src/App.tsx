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
  EyeOff, 
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
  Instagram,
  Lock,
  Trophy,
  X as XIcon,
  ChevronDown,
  PenLine,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const LANGUAGES: { code: Language; label: string }[] = [
    { code: 'en', label: 'EN' },
    { code: 'de', label: 'DE' },
    { code: 'es', label: 'ES' },
    { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' },
  ];
  const [lang, setLang] = useState<Language>('en');
  const cycleLang = () => {
    const idx = LANGUAGES.findIndex(l => l.code === lang);
    setLang(LANGUAGES[(idx + 1) % LANGUAGES.length].code);
  };
  const [sensitivity, setSensitivity] = useState(5); // 1 = tolerant, 10 = streng
  const [timer, setTimer] = useState(60);
  const [alarmSoundIndex, setAlarmSoundIndex] = useState(0);
  const [privacyBlur, setPrivacyBlur] = useState(() =>
    new URLSearchParams(window.location.search).get('incognito') === '1'
  );
  const [metrics, setMetrics] = useState<PostureMetrics | null>(null);
  const warningStartTimeRef = useRef<number | null>(null);
  const NOTIFICATION_COOLDOWN_MS = 1 * 60 * 60 * 1000; // max. 1 Systemmeldung pro Stunde
  const NOTIFICATION_STORAGE_KEY = 'backwatch_last_system_notification';
  const [showCalibratedFeedback, setShowCalibratedFeedback] = useState(false);
  const [showStartupCalibrationHint, setShowStartupCalibrationHint] = useState(
    () => localStorage.getItem('backwatch_calibration_seen') !== '1'
  );
  const [showCalibrateReminder, setShowCalibrateReminder] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [skeletonColor, setSkeletonColor] = useState<'green' | 'blue' | 'lightblue' | 'yellow' | 'white'>('green');
  const [metricsExpanded, setMetricsExpanded] = useState(false);
  const [writingMode, setWritingMode] = useState(() =>
    new URLSearchParams(window.location.search).get('writing') === '1'
  );
  const [tipIndex, setTipIndex] = useState(0);
  const [tipVisible, setTipVisible] = useState(true);

  // Session Tracking
  const [sessionSummary, setSessionSummary] = useState<{
    percent: number;
    durationMin: number;
    sensitivity: number;
    writingMin: number;
  } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const sessionGoodFramesRef = useRef(0);
  const sessionTotalFramesRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);
  const writingModeStartRef = useRef<number | null>(null);
  const writingModeAccumRef = useRef(0); // accumulated ms in writing mode
  
  const t = translations[lang];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const ALARM_SOUNDS = [
    { url: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3', labelKey: 'alarmSoundDefault' as const },
    { url: 'https://assets.mixkit.co/active_storage/sfx/2578/2578-preview.mp3', labelKey: 'alarmSoundSignal' as const },
    { url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3', labelKey: 'alarmSoundClassic' as const },
  ];

  const handleMetricsUpdate = useCallback((newMetrics: PostureMetrics) => {
    setMetrics(newMetrics);
    // Session tracking: nur wenn Person sichtbar
    if (newMetrics.personVisible) {
      sessionTotalFramesRef.current += 1;
      if (!newMetrics.isWarning && !newMetrics.isAlarm) {
        sessionGoodFramesRef.current += 1;
      }
    }
  }, []);

  const SKELETON_COLORS = {
    green:     '#34C759',
    blue:      '#0A84FF',
    lightblue: '#50D2E8',
    yellow:    '#FFD60A',
    white:     '#FFFFFF',
  };

  const { videoRef, canvasRef, startCamera, stopCamera, calibrate, isActive, error: cameraError, calibrationCount } = usePostureTracking({
    sensitivity,
    onMetricsUpdate: handleMetricsUpdate,
    privacyBlur,
    writingMode,
    skeletonColor: SKELETON_COLORS[skeletonColor],
    getErrorMessages: () => ({ cameraInUse: t.cameraInUse, cameraError: t.cameraError, cameraPermissionDenied: t.cameraPermissionDenied }),
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

  // Nach 5 Minuten: System-Benachrichtigung wenn noch nicht kalibriert
  useEffect(() => {
    if (!isActive) return;
    const id = setTimeout(() => {
      if (calibrationCountRef.current === 0 && Notification.permission === 'granted') {
        new Notification(t.notifications.title, {
          body: t.notificationCalibrateBody,
          silent: false,
        });
      }
    }, 5 * 60 * 1000);
    return () => clearTimeout(id);
  }, [isActive, t]);

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

  // Posture tip rotation: fade out → change → fade in every 9 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTipVisible(false);
      setTimeout(() => {
        setTipIndex(i => (i + 1) % t.postureTips.length);
        setTipVisible(true);
      }, 500);
    }, 9000);
    return () => clearInterval(interval);
  }, [t.postureTips.length]);

  const getStatusColor = () => {
    if (!isActive) return 'bg-gray-500';
    if (metrics?.personVisible === false) return 'bg-gray-500';
    if (metrics?.isAlarm) return 'bg-apple-red shadow-[0_0_12px_rgba(255,59,48,0.6)] animate-pulse';
    if (metrics?.isWarning) return 'bg-apple-orange shadow-[0_0_12px_rgba(255,149,0,0.6)]';
    return 'bg-apple-green shadow-[0_0_12px_rgba(52,199,89,0.6)]';
  };

  return (
    <div className="min-h-screen flex flex-col font-sans overflow-hidden app-theme" data-theme={theme}>
      {/* Start-Hinweis: Kalibrierung (nur beim ersten Start) */}
      <AnimatePresence>
        {showStartupCalibrationHint && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            onClick={() => { localStorage.setItem('backwatch_calibration_seen', '1'); setShowStartupCalibrationHint(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-panel p-6 max-w-md text-center space-y-4"
            >
              <p className="text-base font-semibold text-white leading-snug">
                {t.startupCalibrationTitle}
              </p>
              <p className="text-sm text-white/70 leading-relaxed">
                {t.startupCalibrationMessage}
              </p>
              <button
                onClick={() => { localStorage.setItem('backwatch_calibration_seen', '1'); setShowStartupCalibrationHint(false); }}
                className="px-6 py-2.5 bg-apple-green hover:bg-apple-green/80 text-white rounded-xl font-semibold text-sm transition-colors"
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
          <div className="app-logo w-10 h-10 bg-apple-green rounded-xl flex items-center justify-center shadow-lg shadow-apple-green/20" style={{padding: '0'}}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="white" xmlns="http://www.w3.org/2000/svg">
              <circle cx="13.5" cy="4" r="2.8" />
              <rect x="4" y="9" width="2.8" height="11" rx="1.4" />
              <rect x="6.8" y="9" width="7.2" height="7.5" rx="1.5" />
              <rect x="6.8" y="15.5" width="11.2" height="3" rx="1.5" />
              <rect x="15.8" y="17.5" width="2.8" height="5.5" rx="1.4" />
            </svg>
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
            onClick={cycleLang}
            title={t.switchLanguage}
            className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-white/10 rounded-full transition-colors"
          >
            <Languages className="w-4 h-4 text-white/50" />
            <span className="text-xs font-semibold text-white/70">
              {LANGUAGES.find(l => l.code === lang)?.label}
            </span>
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
            width={1280}
            height={720}
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
                    onClick={() => {
                      sessionGoodFramesRef.current = 0;
                      sessionTotalFramesRef.current = 0;
                      sessionStartRef.current = Date.now();
                      writingModeAccumRef.current = 0;
                      writingModeStartRef.current = null;
                      setWritingMode(false);
                      setSessionSummary(null);
                      startCamera();
                    }}
                    className="px-8 py-4 bg-apple-green hover:bg-apple-green/80 text-white rounded-2xl font-semibold flex items-center gap-3 transition-all transform hover:scale-105 active:scale-95 shadow-2xl shadow-apple-green/30"
                  >
                    <Camera className="w-6 h-6" />
                    {t.startCamera}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Calibrate Button – größer, oberhalb der Leiste */}
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <button
              onClick={calibrate}
              disabled={!isActive}
              title={t.calibrateHint}
              className={`px-6 py-3 text-sm font-semibold rounded-2xl transition-all flex items-center gap-2.5 shadow-xl ${
                showCalibratedFeedback
                  ? 'bg-apple-green text-white shadow-apple-green/30'
                  : 'glass-panel text-white/90 hover:bg-white/15'
              }`}
            >
              {showCalibratedFeedback ? (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  {t.calibrated}
                </>
              ) : (
                <>
                  <Target className="w-5 h-5 text-apple-orange" />
                  {t.calibrate}
                </>
              )}
            </button>
          </div>

          {/* Overlay Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-3 glass-panel z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <button 
              onClick={() => setPrivacyBlur(!privacyBlur)}
              className={`p-2 rounded-xl transition-colors ${privacyBlur ? 'bg-apple-green text-white' : 'hover:bg-white/10 text-white/60'}`}
              title={t.privacyBlur}
            >
              {privacyBlur ? <EyeOff className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </button>
            <div className="w-px h-6 bg-white/10" />
            <button
              onClick={() => setWritingMode(v => {
                if (!v) {
                  writingModeStartRef.current = Date.now();
                } else if (writingModeStartRef.current) {
                  writingModeAccumRef.current += Date.now() - writingModeStartRef.current;
                  writingModeStartRef.current = null;
                }
                return !v;
              })}
              title={t.writingMode}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 ${
                writingMode ? 'bg-apple-green text-white shadow-md shadow-apple-green/30' : 'hover:bg-white/10 text-white/80'
              }`}
            >
              {writingMode ? (
                <>
                  <Lock className="w-4 h-4" />
                  {t.writingMode}
                </>
              ) : (
                <>
                  <PenLine className="w-4 h-4" />
                  {t.writingMode}
                </>
              )}
            </button>
            <div className="w-px h-6 bg-white/10" />
            <button 
              onClick={() => {
                stopCamera();
                const total = sessionTotalFramesRef.current;
                const good = sessionGoodFramesRef.current;
                const percent = total > 0 ? Math.round((good / total) * 100) : 0;
                const durationMin = sessionStartRef.current
                  ? Math.round((Date.now() - sessionStartRef.current) / 60000)
                  : 0;
                // Finalize writing mode time if still active
                let writingMs = writingModeAccumRef.current;
                if (writingMode && writingModeStartRef.current) {
                  writingMs += Date.now() - writingModeStartRef.current;
                }
                const writingMin = Math.round(writingMs / 60000);
                setSessionSummary({ percent, durationMin, sensitivity, writingMin });
              }}
              className="px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 hover:bg-apple-red/20 text-apple-red"
            >
              <StopCircle className="w-5 h-5" />
              {t.end}
            </button>
          </div>
        </section>

        {/* Sidebar Controls */}
        <aside className="space-y-6">
          {/* Live Metrics oben */}
          <div className="glass-panel overflow-hidden">
            <button
              onClick={() => setMetricsExpanded(v => !v)}
              className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/5 transition-colors"
            >
              <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">{t.liveMetrics}</h2>
              <ChevronDown
                className={`w-3.5 h-3.5 text-white/30 transition-transform duration-300 ${metricsExpanded ? 'rotate-0' : '-rotate-90'}`}
              />
            </button>
            <motion.div
              initial={false}
              animate={{ height: metricsExpanded ? 'auto' : 0, opacity: metricsExpanded ? 1 : 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div className="px-6 pb-5 space-y-3">
                {metrics?.personVisible === false ? (
                  <p className="text-xs text-white/40">{t.status.notVisible}</p>
                ) : (
                  <>
                    <MetricRow label={t.neckAngle} value={`${metrics?.neckAngle != null ? metrics.neckAngle.toFixed(0) : '—'}°`} active={metrics?.isNeckWarning} />
                    <MetricRow label={t.zDistance} value={metrics?.screenDistance != null ? (metrics.screenDistance).toFixed(2) : '—'} active={metrics?.isAlarm} />
                    <MetricRow label={t.slouch} value={metrics?.slouchFactor != null ? (metrics.slouchFactor).toFixed(2) : '—'} active={metrics?.isWarning} />
                  </>
                )}
              </div>
            </motion.div>
          </div>

          <div className="glass-panel p-6 space-y-6">
            <div className="flex items-center gap-2 text-white/40">
              <Settings className="w-4 h-4" />
              <h2 className="text-[10px] uppercase tracking-widest font-bold">{t.sensitivity}</h2>
            </div>
            
            <div className={`space-y-3 ${!isActive ? 'opacity-60' : ''}`}>
              {/* Rounded tooth-style buttons 1–10 */}
              <div className="flex gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => (
                  <button
                    key={val}
                    disabled={!isActive}
                    onClick={() => setSensitivity(val)}
                    className={`flex-1 h-8 rounded-full text-[10px] font-semibold transition-all duration-200 disabled:cursor-not-allowed ${
                      val === sensitivity
                        ? 'bg-apple-green text-white shadow-md shadow-apple-green/30 scale-105'
                        : val < sensitivity
                          ? 'bg-apple-green/25 text-apple-green'
                          : 'bg-white/10 text-white/40 hover:bg-white/20'
                    }`}
                  >
                    {val}
                  </button>
                ))}
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
              <div className="grid grid-cols-5 gap-1.5 p-1 rounded-xl bg-black/40 border border-white/5">
                {[5, 10, 15, 30, 45, 60, 90, 120, 180, 300].map((val) => (
                  <button
                    key={val}
                    onClick={() => setTimer(val)}
                    className={`min-h-[36px] rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-center ${
                      timer === val
                        ? 'bg-apple-green/20 text-apple-green shadow-sm border border-apple-green/30'
                        : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {val < 60 ? `${val}s` : val % 60 === 0 ? `${val / 60}min` : `${Math.floor(val / 60)}.5min`}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-white/5 space-y-3">
              <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">{t.skeletonColor}</h2>
              <div className="flex gap-2">
                {([
                  { key: 'green',     hex: '#34C759' },
                  { key: 'blue',      hex: '#0A84FF' },
                  { key: 'lightblue', hex: '#50D2E8' },
                  { key: 'yellow',    hex: '#FFD60A' },
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
                    onClick={() => {
                      setAlarmSoundIndex(idx);
                      // Stop any running preview
                      if (previewAudioRef.current) {
                        previewAudioRef.current.pause();
                        previewAudioRef.current.currentTime = 0;
                      }
                      // Play short preview (max 3s)
                      const preview = new Audio(sound.url);
                      previewAudioRef.current = preview;
                      preview.volume = 0.6;
                      preview.play().catch(() => {});
                      setTimeout(() => {
                        preview.pause();
                        preview.currentTime = 0;
                      }, 3000);
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                      alarmSoundIndex === idx ? 'bg-apple-green text-white' : 'bg-white/10 text-white/60 hover:text-white/80'
                    }`}
                  >
                    <Play className="w-3 h-3 opacity-60" />
                    {t[sound.labelKey]}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-white/5">
              <p className="text-[11px] text-white/50 leading-relaxed">
                <span className="font-semibold text-white/70">{t.calibrateHintLabel} </span>
                {t.calibrateHint}
              </p>
            </div>
          </div>

          {/* Posture Tips */}
          <div className="glass-panel p-5 space-y-3">
            <h2 className="text-[10px] uppercase tracking-widest font-bold text-white/40">{t.postureTipsLabel}</h2>
            <p
              className="text-xs text-white/70 leading-relaxed transition-opacity duration-500"
              style={{ opacity: tipVisible ? 1 : 0 }}
            >
              {t.postureTips[tipIndex]}
            </p>
            {/* Progress dots */}
            <div className="flex gap-1 pt-1">
              {t.postureTips.map((_, i) => (
                <button
                  key={i}
                  onClick={() => { setTipVisible(false); setTimeout(() => { setTipIndex(i); setTipVisible(true); }, 300); }}
                  className="h-1 rounded-full transition-all duration-300"
                  style={{
                    width: i === tipIndex ? '16px' : '4px',
                    background: i === tipIndex ? '#34C759' : 'rgba(255,255,255,0.2)',
                  }}
                />
              ))}
            </div>
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
        <div className="text-center space-y-1.5">
          <p className="text-[11px] text-white/50 font-semibold tracking-wide">{t.footerSlogan}</p>
          <p className="text-[10px] text-white/30 leading-relaxed max-w-sm mx-auto">{t.footerTagline}</p>
          <p className="text-[9px] text-white/20 font-medium tracking-wide">{t.footerDisclaimer}</p>
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
            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="text-white/20 hover:text-white/50 transition-colors" title="Instagram">
              <Instagram className="w-4 h-4" />
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

      {/* Session Summary Modal */}
      <AnimatePresence>
        {sessionSummary && (() => {
          const accentColor = sessionSummary.percent >= 80 ? '#34C759' : sessionSummary.percent >= 50 ? '#FF9F0A' : '#FF3B30';
          const accentBg = sessionSummary.percent >= 80 ? 'rgba(52,199,89,0.15)' : sessionSummary.percent >= 50 ? 'rgba(255,159,10,0.15)' : 'rgba(255,59,48,0.15)';
          const shareText = t.sessionShareText
            .replace('{percent}', String(sessionSummary.percent))
            .replace('{min}', String(sessionSummary.durationMin));
          const shareUrl = 'https://backwatch.app';
          const encodedText = encodeURIComponent(shareText);
          const encodedUrl = encodeURIComponent(shareUrl);

          const handleNativeShare = async () => {
            if (navigator.share) {
              try { await navigator.share({ title: 'BackWatch', text: shareText, url: shareUrl }); } catch {}
            }
          };
          const handleCopy = () => {
            navigator.clipboard.writeText(`${shareText} ${shareUrl}`).then(() => {
              setShareCopied(true);
              setTimeout(() => setShareCopied(false), 2000);
            });
          };

          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
            >
              <motion.div
                initial={{ scale: 0.85, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                className="glass-panel p-8 max-w-sm w-full mx-4 text-center space-y-5 relative"
              >
                <button
                  onClick={() => setSessionSummary(null)}
                  className="absolute top-4 right-4 text-white/30 hover:text-white/70 transition-colors"
                >
                  <XIcon className="w-4 h-4" />
                </button>

                {/* Trophy Icon */}
                <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto" style={{ background: accentBg }}>
                  <Trophy className="w-9 h-9" style={{ color: accentColor }} />
                </div>

                {/* Stats */}
                <div>
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-1">
                    {t.sessionSummaryLabel}
                  </p>
                  <p className="text-white text-4xl font-bold leading-none">
                    {sessionSummary.percent}%
                  </p>
                  <p className="text-white/60 text-sm mt-2 leading-snug">
                    {t.sessionSummaryText.replace('{percent}', String(sessionSummary.percent))}
                  </p>
                </div>

                {/* Info chips: Duration · Sensitivity · Writing Mode */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {/* Duration */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/8 border border-white/10">
                    <svg className="w-3.5 h-3.5 text-white/40" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <span className="text-white/60 text-xs font-medium">
                      {t.sessionDuration.replace('{min}', String(sessionSummary.durationMin))}
                    </span>
                  </div>
                  {/* Sensitivity */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/8 border border-white/10">
                    <svg className="w-3.5 h-3.5 text-white/40" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 6v4l3 3"/>
                    </svg>
                    <span className="text-white/60 text-xs font-medium">
                      {t.sessionSensitivity.replace('{level}', String(sessionSummary.sensitivity))}
                    </span>
                  </div>
                  {/* Writing Mode */}
                  {sessionSummary.writingMin > 0 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-apple-green/10 border border-apple-green/20">
                      <PenLine className="w-3.5 h-3.5 text-apple-green/70" />
                      <span className="text-apple-green/80 text-xs font-medium">
                        {t.sessionWritingMode.replace('{min}', String(sessionSummary.writingMin))}
                      </span>
                    </div>
                  )}
                </div>

                {/* Writing Mode protection note */}
                {sessionSummary.writingMin > 0 && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/5 border border-white/8 text-left">
                    <Lock className="w-3.5 h-3.5 text-apple-green/60 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-white/45 leading-relaxed">
                      {t.sessionWritingProtected.replace('{min}', String(sessionSummary.writingMin))}
                    </p>
                  </div>
                )}

                {/* Rating bar */}
                <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${sessionSummary.percent}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{ background: accentColor }}
                  />
                </div>

                {/* Share section */}
                <div className="space-y-2">
                  <p className="text-white/30 text-xs uppercase tracking-widest font-semibold">{t.sessionShareLabel}</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {/* X / Twitter */}
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                      title="X / Twitter"
                    >
                      <Twitter className="w-4 h-4 text-white/60" />
                    </a>
                    {/* WhatsApp */}
                    <a
                      href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                      title="WhatsApp"
                    >
                      <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                    </a>
                    {/* LinkedIn */}
                    <a
                      href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}&summary=${encodedText}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                      title="LinkedIn"
                    >
                      <Linkedin className="w-4 h-4 text-white/60" />
                    </a>
                    {/* Telegram */}
                    <a
                      href={`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                      title="Telegram"
                    >
                      <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                      </svg>
                    </a>
                    {/* Snapchat */}
                    <a
                      href={`https://www.snapchat.com/scan?attachmentUrl=${encodedUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                      title="Snapchat"
                    >
                      <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.253-.27.43-.554.43h-.076c-.24 0-.569-.111-1.046-.254-.54-.165-1.186-.36-1.996-.36-.648 0-1.29.135-1.9.449-1.064.574-1.753 1.349-2.833 1.349h-.179c-1.124 0-1.813-.76-2.863-1.349-.61-.314-1.257-.449-1.9-.449-.81 0-1.46.195-1.995.36-.48.149-.81.254-1.05.254h-.075c-.284 0-.479-.177-.539-.445-.061-.194-.105-.375-.135-.554-.044-.195-.105-.479-.164-.57-1.873-.283-2.906-.702-3.146-1.271-.03-.076-.045-.15-.045-.225-.016-.239.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.21-.645.119-.869-.195-.45-.884-.675-1.332-.81-.136-.044-.256-.09-.345-.119-1.213-.36-1.618-.82-1.603-1.168.016-.359.3-.689.75-.838.149-.061.329-.09.51-.09.12 0 .3.016.465.104.374.181.732.285 1.033.301.197 0 .325-.045.399-.09-.008-.165-.019-.33-.03-.51l-.004-.06c-.103-1.628-.229-3.654.3-4.847C7.858 1.07 11.216.793 12.206.793z"/>
                      </svg>
                    </a>
                    {/* Signal */}
                    <a
                      href={`https://signal.me/#p=${encodedText}%20${encodedUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                      title="Signal"
                    >
                      <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm.208 4.342l.667.158a7.45 7.45 0 0 1 1.625.592l.58-.4.932.932-.4.581a7.459 7.459 0 0 1 .741 1.896l.666.158v1.318l-.666.158a7.459 7.459 0 0 1-.741 1.896l.4.581-.932.932-.58-.4a7.45 7.45 0 0 1-1.625.592l-.667.158h-1.318l-.667-.158a7.45 7.45 0 0 1-1.625-.592l-.58.4-.932-.932.4-.581a7.459 7.459 0 0 1-.741-1.896l-.666-.158V9.26l.666-.158a7.459 7.459 0 0 1 .741-1.896l-.4-.581.932-.932.58.4a7.45 7.45 0 0 1 1.625-.592l.667-.158h1.318zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/>
                      </svg>
                    </a>
                    {/* Slack */}
                    <a
                      href={`https://slack.com/intl/share?text=${encodedText}%20${encodedUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                      title="Slack"
                    >
                      <svg className="w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                      </svg>
                    </a>
                    {/* Native Share (mobile) */}
                    {typeof navigator !== 'undefined' && !!navigator.share && (
                      <button
                        onClick={handleNativeShare}
                        className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                        title={t.sessionShareNative}
                      >
                        <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                        </svg>
                      </button>
                    )}
                    {/* Copy link */}
                    <button
                      onClick={handleCopy}
                      className="w-9 h-9 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 flex items-center justify-center transition-colors"
                      title={t.sessionShareCopy}
                    >
                      {shareCopied ? (
                        <CheckCircle2 className="w-4 h-4 text-apple-green" />
                      ) : (
                        <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setSessionSummary(null)}
                  className="w-full py-3 rounded-2xl font-semibold text-sm transition-all bg-white/10 hover:bg-white/20 text-white"
                >
                  {t.sessionSummaryClose}
                </button>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
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
