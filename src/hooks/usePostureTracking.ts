import { useEffect, useRef, useState, useCallback } from 'react';
import { Pose, POSE_CONNECTIONS, Results } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';

export interface PostureMetrics {
  neckAngle: number;
  screenDistance: number;
  slouchFactor: number;
  isOptimal: boolean;
  isWarning: boolean;
  isAlarm: boolean;
  /** false = niemand sichtbar, keine Werte anzeigen, kein Alarm */
  personVisible: boolean;
}

interface UsePostureTrackingProps {
  sensitivity: number;
  onMetricsUpdate: (metrics: PostureMetrics) => void;
  privacyBlur: boolean;
  getErrorMessages?: () => { cameraInUse: string; cameraError: string };
}

export const usePostureTracking = ({
  sensitivity,
  onMetricsUpdate,
  privacyBlur,
  getErrorMessages,
}: UsePostureTrackingProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<Pose | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const baselineRef = useRef<Results | null>(null);
  const sensitivityRef = useRef(sensitivity);
  const privacyBlurRef = useRef(privacyBlur);
  const onMetricsUpdateRef = useRef(onMetricsUpdate);
  const getErrorMessagesRef = useRef(getErrorMessages);
  getErrorMessagesRef.current = getErrorMessages;
  
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calibrationCount, setCalibrationCount] = useState(0);
  const lastUpdateRef = useRef<number>(0);

  sensitivityRef.current = sensitivity;
  privacyBlurRef.current = privacyBlur;
  onMetricsUpdateRef.current = onMetricsUpdate;

  const calculateAngle = (p1: any, p2: any, p3: any) => {
    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
  };

  /** Prüft, ob eine Person wirklich sichtbar ist (keine Phantom-Pose). */
  const isPersonReallyVisible = (landmarks: Array<{ x: number; y: number; visibility?: number }>): boolean => {
    if (!landmarks || landmarks.length < 13) return false;
    const nose = landmarks[0];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    if (!nose || !leftShoulder || !rightShoulder) return false;
    const inFrame = (p: { x: number; y: number }) => p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;
    if (!inFrame(nose) || !inFrame(leftShoulder) || !inFrame(rightShoulder)) return false;
    const vis = (p: { visibility?: number }) => p.visibility == null || p.visibility > 0.5;
    if (!vis(nose) || !vis(leftShoulder) || !vis(rightShoulder)) return false;
    const shoulderDist = Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);
    if (shoulderDist < 0.02) return false;
    return true;
  };

  const onResults = useCallback((results: Results) => {
    if (!canvasRef.current || !videoRef.current) return;

    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, width, height);

    // Draw Video with optional Privacy Blur
    if (privacyBlurRef.current) {
      canvasCtx.filter = 'blur(20px) brightness(0.7)';
    }
    canvasCtx.drawImage(results.image, 0, 0, width, height);
    canvasCtx.filter = 'none';

    if (results.poseLandmarks) {
      const landmarks = results.poseLandmarks;
      const personVisible = isPersonReallyVisible(landmarks);

      if (!personVisible) {
        const now = Date.now();
        if (now - lastUpdateRef.current > 100) {
          onMetricsUpdateRef.current({
            neckAngle: 0,
            screenDistance: 0,
            slouchFactor: 0,
            isOptimal: true,
            isWarning: false,
            isAlarm: false,
            personVisible: false,
          });
          lastUpdateRef.current = now;
        }
        canvasCtx.restore();
        return;
      }

      // Posture Analysis (nur bei wirklich sichtbarer Person)
      // Neck Angle: Ear (7 or 8) to Shoulder (11 or 12)
      // We'll use the side that is more visible or just average
      const leftEar = landmarks[7];
      const leftShoulder = landmarks[11];
      const rightEar = landmarks[8];
      const rightShoulder = landmarks[12];

      // Simple vertical reference for neck angle
      const neckAngle = calculateAngle(
        { x: leftEar.x, y: leftEar.y - 0.1 }, // Virtual point above ear
        leftEar,
        leftShoulder
      );

      // Screen Distance: Distance between shoulders as proxy for Z
      const shoulderDist = Math.sqrt(
        Math.pow(leftShoulder.x - rightShoulder.x, 2) + 
        Math.pow(leftShoulder.y - rightShoulder.y, 2)
      );
      
      // Slouching: Shoulder height
      const shoulderHeight = (leftShoulder.y + rightShoulder.y) / 2;

      let isWarning = false;
      let isAlarm = false;

      if (baselineRef.current?.poseLandmarks) {
        const bLandmarks = baselineRef.current.poseLandmarks;
        const bShoulderDist = Math.sqrt(
          Math.pow(bLandmarks[11].x - bLandmarks[12].x, 2) + 
          Math.pow(bLandmarks[11].y - bLandmarks[12].y, 2)
        );
        const bShoulderHeight = (bLandmarks[11].y + bLandmarks[12].y) / 2;

        const sens = sensitivityRef.current;
        const toleranceFactor = (10 - sens) / 9;
        const nose = landmarks[0];
        const earMidX = (leftEar.x + rightEar.x) / 2;
        const isSideways = nose && Math.abs(nose.x - earMidX) >= 0.07;

        // Z-Distanz: Sens 1–4 wie bisher; ab Sens 5 weniger streng (mehr Toleranz)
        const zThreshold = sens >= 5
          ? 1.12 + (10 - sens) * 0.01   // ab 5: toleranter (1.17 bei 5, 1.12 bei 10)
          : sens >= 4
            ? 1.05 + (10 - sens) * 0.008
            : 1.15 + 0.15 * toleranceFactor;
        if (shoulderDist > bShoulderDist * zThreshold) isAlarm = true;

        // Slouch: Sens 8–10 streng, Sens 6–7 mittel (strenger als 5, weniger als 8), sonst normal
        const useStrictSlouch = sens >= 6 || (isSideways && sens >= 5);
        const slouchThreshold = !useStrictSlouch
          ? 0.03 + 0.07 * toleranceFactor
          : sens === 6
            ? 0.055
            : sens === 7
              ? 0.042
              : 0.02 + (10 - sens) * 0.003;
        if (shoulderHeight > bShoulderHeight + slouchThreshold) isWarning = true;

        // Neck Angle: Sens 8–10 streng, Sens 6–7 mittel (strenger als 5, weniger als 8), sonst normal
        const useStrictNeck = sens >= 6 || (isSideways && sens >= 5);
        const neckThreshold = !useStrictNeck
          ? 150 - 25 * toleranceFactor
          : sens === 6
            ? 142
            : sens === 7
              ? 148
              : 155 - (10 - sens) * 1;
        if (neckAngle < neckThreshold) isWarning = true;

        // User aufgestanden oder wegbewegt → Alarm ausschalten
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        // 1) Aufstehen: Oberkörper aufrecht (Schulter–Hüfte-Abstand größer als beim Kalibrieren)
        if (leftHip && rightHip) {
          const hipCenterY = (leftHip.y + rightHip.y) / 2;
          const bHipCenterY = (bLandmarks[23].y + bLandmarks[24].y) / 2;
          const torsoExtent = hipCenterY - shoulderHeight;
          const bTorsoExtent = bHipCenterY - bShoulderHeight;
          if (bTorsoExtent > 0.01 && torsoExtent > bTorsoExtent * 1.12) {
            isWarning = false;
            isAlarm = false;
          }
        }
        // 2) Wegbewegt: Person deutlich kleiner im Bild (weiter weg) → kein Sitz-Alarm
        if (shoulderDist < bShoulderDist * 0.62) {
          isWarning = false;
          isAlarm = false;
        }
      }

      // Z-Distanz-Anzeige: Standard 55, näher = kleiner, weiter = größer
      const Z_DISTANCE_DEFAULT = 55;
      const bLandmarksForZ = baselineRef.current?.poseLandmarks;
      const bShoulderDistForZ = bLandmarksForZ
        ? Math.sqrt(
            Math.pow(bLandmarksForZ[11].x - bLandmarksForZ[12].x, 2) +
            Math.pow(bLandmarksForZ[11].y - bLandmarksForZ[12].y, 2)
          )
        : null;
      const screenDistanceDisplay =
        bShoulderDistForZ != null && bShoulderDistForZ > 0
          ? Z_DISTANCE_DEFAULT * (bShoulderDistForZ / shoulderDist)
          : Z_DISTANCE_DEFAULT;

      const now = Date.now();
      if (now - lastUpdateRef.current > 100) {
        onMetricsUpdateRef.current({
          neckAngle,
          screenDistance: screenDistanceDisplay,
          slouchFactor: shoulderHeight,
          isOptimal: !isWarning && !isAlarm,
          isWarning,
          isAlarm,
          personVisible: true,
        });
        lastUpdateRef.current = now;
      }

      // Drawing Skeleton (always draw for smoothness)
      canvasCtx.globalAlpha = 0.4;
      canvasCtx.lineWidth = 0.5;
      
      // Default color: Apple Blue
      const baseColor = isAlarm ? '#FF3B30' : '#0A84FF';
      const spineColor = (isWarning || isAlarm) ? '#FF3B30' : '#D8D8D8';  // Normal: leicht grau, etwas weißer

      // Wirbelsäule: Hüfte → Schulter → Hinterkopf (auf Ohrhöhe), Krümmung verstärkt
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];
      const nose = landmarks[0];
      if (leftHip && rightHip && nose) {
        const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
        const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
        const hipCenterX = (leftHip.x + rightHip.x) / 2;
        const hipCenterY = (leftHip.y + rightHip.y) / 2;
        const earMidX = (leftEar.x + rightEar.x) / 2;
        const earMidY = (leftEar.y + rightEar.y) / 2;
        const dx = earMidX - nose.x;
        const dy = earMidY - nose.y;
        const len = Math.hypot(dx, dy) || 1e-6;
        const backOffset = 0.08;
        const backOfHeadX = earMidX + (dx / len) * backOffset;
        const backOfHeadY = earMidY + (dy / len) * backOffset;
        // Abweichung Schulter von der Geraden Hüfte–Kopf (Richtung der Krümmung)
        const Lx = backOfHeadX - hipCenterX;
        const Ly = backOfHeadY - hipCenterY;
        const L2 = Lx * Lx + Ly * Ly || 1e-12;
        const t = Math.max(0, Math.min(1, ((shoulderCenterX - hipCenterX) * Lx + (shoulderCenterY - hipCenterY) * Ly) / L2));
        const projX = hipCenterX + t * Lx;
        const projY = hipCenterY + t * Ly;
        const offsetX = shoulderCenterX - projX;
        const offsetY = shoulderCenterY - projY;
        // Kubische Bézierkurve: zweiter Kontrollpunkt im oberen Rücken/Schulter → mehr Krümmung dort
        const c1X = (hipCenterX + shoulderCenterX) / 2 + offsetX * 0.6;
        const c1Y = (hipCenterY + shoulderCenterY) / 2 + offsetY * 0.6;
        const upperBackX = shoulderCenterX * 0.7 + backOfHeadX * 0.3;  // Bereich Schulter/oberer Rücken
        const upperBackY = shoulderCenterY * 0.7 + backOfHeadY * 0.3;
        const c2X = upperBackX + offsetX * 1.35;  // starke Krümmung im oberen Rücken
        const c2Y = upperBackY + offsetY * 1.35;
        canvasCtx.save();
        canvasCtx.globalAlpha = 0.12;  // Wirbelsäule transparenter, leicht grau
        canvasCtx.beginPath();
        canvasCtx.strokeStyle = spineColor;
        canvasCtx.lineWidth = 3;
        canvasCtx.shadowBlur = 6;
        canvasCtx.shadowColor = spineColor;
        canvasCtx.moveTo(hipCenterX * width, hipCenterY * height);
        canvasCtx.bezierCurveTo(
          c1X * width, c1Y * height,
          c2X * width, c2Y * height,
          backOfHeadX * width, backOfHeadY * height
        );
        canvasCtx.stroke();
        canvasCtx.restore();
        canvasCtx.lineWidth = 0.5;
      }
      
      // Custom drawing to highlight problem zones (Nacken, restliches Skelett)
      POSE_CONNECTIONS.forEach(([start, end]) => {
        const isNeckConnection = (start === 7 && end === 11) || (start === 8 && end === 12);
        
        canvasCtx.beginPath();
        canvasCtx.strokeStyle = (isNeckConnection && isWarning) ? '#FF3B30' : baseColor;
        canvasCtx.shadowBlur = 4;
        canvasCtx.shadowColor = canvasCtx.strokeStyle;
        
        const startPoint = landmarks[start];
        const endPoint = landmarks[end];
        
        canvasCtx.moveTo(startPoint.x * width, startPoint.y * height);
        canvasCtx.lineTo(endPoint.x * width, endPoint.y * height);
        canvasCtx.stroke();
      });

      // Draw landmarks
      drawLandmarks(canvasCtx, landmarks, {
        color: baseColor,
        lineWidth: 0.5,
        radius: 1,
      });
    } else {
      // Keine Pose (niemand sitzt vor der Kamera) → keine Werte, kein Alarm
      const now = Date.now();
      if (now - lastUpdateRef.current > 100) {
        onMetricsUpdateRef.current({
          neckAngle: 0,
          screenDistance: 0,
          slouchFactor: 0,
          isOptimal: true,
          isWarning: false,
          isAlarm: false,
          personVisible: false,
        });
        lastUpdateRef.current = now;
      }
    }

    canvasCtx.restore();
  }, []); // Refs für sensitivity/privacyBlur/onMetricsUpdate – kein Neustart der Pose-Pipeline

  useEffect(() => {
    const pose = new Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      },
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    pose.onResults(onResults);
    poseRef.current = pose;

    return () => {
      pose.close();
    };
  }, [onResults]);

  const startCamera = async () => {
    if (!videoRef.current || !poseRef.current) return;

    try {
      setError(null);
      
      // Stop existing camera if any
      if (cameraRef.current) {
        await cameraRef.current.stop();
      }

      cameraRef.current = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current && poseRef.current) {
            try {
              await poseRef.current.send({ image: videoRef.current });
            } catch (e) {
              console.error("Pose processing error:", e);
            }
          }
        },
        width: 1280,
        height: 720,
      });

      await cameraRef.current.start();
      setIsActive(true);
    } catch (err: any) {
      console.error("Camera start error:", err);
      const msgs = getErrorMessagesRef.current?.() ?? {
        cameraInUse: "Kamera wird bereits von einer anderen Anwendung verwendet.",
        cameraError: "Kamera konnte nicht gestartet werden",
      };
      if (err.name === 'NotReadableError' || err.message?.includes('in use')) {
        setError(msgs.cameraInUse);
      } else {
        setError(msgs.cameraError + (err.message ? ": " + err.message : ""));
      }
      setIsActive(false);
    }
  };

  const stopCamera = async () => {
    if (cameraRef.current) {
      try {
        await cameraRef.current.stop();
      } catch (e) {
        console.error("Error stopping camera:", e);
      }
      cameraRef.current = null;
      setIsActive(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop().catch(console.error);
      }
    };
  }, []);

  const calibrate = () => {
    if (!poseRef.current) return;
    
    // We capture the next frame as baseline
    const originalOnResults = onResults;
    poseRef.current.onResults((results) => {
      if (results.poseLandmarks) {
        baselineRef.current = results;
        setCalibrationCount(prev => prev + 1);
        // Restore original listener
        poseRef.current?.onResults(originalOnResults);
      }
    });
  };

  return {
    videoRef,
    canvasRef,
    startCamera,
    stopCamera,
    calibrate,
    isActive,
    error,
    calibrationCount,
  };
};
