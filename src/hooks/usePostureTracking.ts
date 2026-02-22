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
  skeletonColor?: string;
  getErrorMessages?: () => { cameraInUse: string; cameraError: string };
}

export const usePostureTracking = ({
  sensitivity,
  onMetricsUpdate,
  privacyBlur,
  skeletonColor = '#0A84FF',
  getErrorMessages,
}: UsePostureTrackingProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<Pose | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const baselineRef = useRef<Results | null>(null);
  const sensitivityRef = useRef(sensitivity);
  const privacyBlurRef = useRef(privacyBlur);
  const skeletonColorRef = useRef(skeletonColor);
  const onMetricsUpdateRef = useRef(onMetricsUpdate);
  const getErrorMessagesRef = useRef(getErrorMessages);
  getErrorMessagesRef.current = getErrorMessages;
  
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calibrationCount, setCalibrationCount] = useState(0);
  const lastUpdateRef = useRef<number>(0);
  const pixelationBufferRef = useRef<HTMLCanvasElement | null>(null);

  sensitivityRef.current = sensitivity;
  privacyBlurRef.current = privacyBlur;
  skeletonColorRef.current = skeletonColor;
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

    // Maximum image quality for the video frame
    canvasCtx.imageSmoothingEnabled = true;
    canvasCtx.imageSmoothingQuality = 'high';

    // Draw Video with optional Privacy Blur (stark verpixelt + Blur)
    if (privacyBlurRef.current) {
      const pixelSize = 6;
      const smallW = Math.max(1, Math.floor(width / pixelSize));
      const smallH = Math.max(1, Math.floor(height / pixelSize));
      let buf = pixelationBufferRef.current;
      if (!buf || buf.width !== smallW || buf.height !== smallH) {
        buf = document.createElement('canvas');
        buf.width = smallW;
        buf.height = smallH;
        pixelationBufferRef.current = buf;
      }
      const bufCtx = buf.getContext('2d');
      if (bufCtx) {
        bufCtx.drawImage(results.image, 0, 0, smallW, smallH);
        canvasCtx.imageSmoothingEnabled = false;
        canvasCtx.filter = 'blur(16px) brightness(0.7)';
        canvasCtx.drawImage(buf, 0, 0, smallW, smallH, 0, 0, width, height);
        canvasCtx.imageSmoothingEnabled = true;
        canvasCtx.filter = 'none';
      } else {
        canvasCtx.filter = 'blur(24px) brightness(0.7)';
        canvasCtx.drawImage(results.image, 0, 0, width, height);
        canvasCtx.filter = 'none';
      }
    } else {
      canvasCtx.drawImage(results.image, 0, 0, width, height);
    }

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
      const leftEar = landmarks[7];
      const leftShoulder = landmarks[11];
      const rightEar = landmarks[8];
      const rightShoulder = landmarks[12];

      // Neck angle: use ear midpoint vs shoulder midpoint for forward tilt
      const earMidX = (leftEar.x + rightEar.x) / 2;
      const earMidY = (leftEar.y + rightEar.y) / 2;
      const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
      const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
      const forwardNeckAngle = calculateAngle(
        { x: earMidX, y: earMidY - 0.1 }, // point above ear midpoint
        { x: earMidX, y: earMidY },
        { x: shoulderMidX, y: shoulderMidY }
      );

      // Lateral tilt penalty: ears unlevel → head tilted sideways → reduce angle
      const earDx = Math.abs(leftEar.x - rightEar.x) || 0.001;
      const earDy = Math.abs(leftEar.y - rightEar.y);
      const lateralTiltDeg = Math.atan2(earDy, earDx) * 180 / Math.PI;

      // Combined: lateral tilt reduces the effective neck angle (worse posture = lower value)
      // Multiplier 0.6 = toleranter bei seitlicher Neigung
      const neckAngle = forwardNeckAngle - lateralTiltDeg * 0.6;

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

        // Neck Angle: Stufe 5 = 150° (darunter schlechte Haltung), restliche Stufen angepasst
        const neckThreshold =
          sens <= 4 ? 125 + (sens - 1) * 5   // 1→125°, 2→130°, 3→135°, 4→140°
          : sens === 5 ? 150                 // 5→150°
          : 150 + (sens - 5);                // 6→151°, 7→152°, … 10→155°
        if (neckAngle < neckThreshold) isWarning = true;

        // Head too far to the side (left or right) → bad posture
        const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
        const headSideOffset = Math.abs(nose.x - shoulderCenterX);
        const headSideThreshold = 0.16 - (sens - 1) * 0.01; // stricter at higher sensitivity
        if (headSideOffset > headSideThreshold) isWarning = true;

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
      const baseColor = isAlarm ? '#FF3B30' : skeletonColorRef.current;
      const spineColor = (isWarning || isAlarm) ? '#FF3B30' : '#D8D8D8';  // Normal: leicht grau, etwas weißer

      // Spine: draw stylized vertebrae along a Bézier curve (Hip → Shoulder → Nose)
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];
      const nose = landmarks[0];
      if (leftHip && rightHip && nose) {
        const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
        const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
        const hipCenterX = (leftHip.x + rightHip.x) / 2;
        const hipCenterY = (leftHip.y + rightHip.y) / 2;
        const headCenterX = nose.x;
        const headCenterY = nose.y;

        // Bézier control points
        const Lx = headCenterX - hipCenterX;
        const Ly = headCenterY - hipCenterY;
        const L2 = Lx * Lx + Ly * Ly || 1e-12;
        const tProj = Math.max(0, Math.min(1, ((shoulderCenterX - hipCenterX) * Lx + (shoulderCenterY - hipCenterY) * Ly) / L2));
        const projX = hipCenterX + tProj * Lx;
        const projY = hipCenterY + tProj * Ly;
        const offsetX = shoulderCenterX - projX;
        const offsetY = shoulderCenterY - projY;
        const c1X = (hipCenterX + shoulderCenterX) / 2 + offsetX * 0.6;
        const c1Y = (hipCenterY + shoulderCenterY) / 2 + offsetY * 0.6;
        const upperX = shoulderCenterX * 0.7 + headCenterX * 0.3;
        const upperY = shoulderCenterY * 0.7 + headCenterY * 0.3;
        const c2X = upperX + offsetX * 1.35;
        const c2Y = upperY + offsetY * 1.35;

        // Helper: point and tangent on cubic Bézier at parameter t
        const P0 = { x: hipCenterX * width, y: hipCenterY * height };
        const P1 = { x: c1X * width, y: c1Y * height };
        const P2 = { x: c2X * width, y: c2Y * height };
        const P3 = { x: headCenterX * width, y: headCenterY * height };

        const bezierPoint = (t: number) => ({
          x: (1-t)**3*P0.x + 3*(1-t)**2*t*P1.x + 3*(1-t)*t**2*P2.x + t**3*P3.x,
          y: (1-t)**3*P0.y + 3*(1-t)**2*t*P1.y + 3*(1-t)*t**2*P2.y + t**3*P3.y,
        });
        const bezierTangent = (t: number) => {
          const dx = 3*(1-t)**2*(P1.x-P0.x) + 6*(1-t)*t*(P2.x-P1.x) + 3*t**2*(P3.x-P2.x);
          const dy = 3*(1-t)**2*(P1.y-P0.y) + 6*(1-t)*t*(P2.y-P1.y) + 3*t**2*(P3.y-P2.y);
          const len = Math.hypot(dx, dy) || 1;
          return { dx: dx/len, dy: dy/len };
        };

        canvasCtx.save();
        canvasCtx.shadowBlur = 6;
        canvasCtx.shadowColor = spineColor;

        // Ribbon: draw the full Bézier curve as a very transparent background band
        canvasCtx.save();
        canvasCtx.globalAlpha = 0.06;
        canvasCtx.strokeStyle = spineColor;
        canvasCtx.lineWidth = 10;
        canvasCtx.lineCap = 'round';
        canvasCtx.lineJoin = 'round';
        canvasCtx.beginPath();
        canvasCtx.moveTo(P0.x, P0.y);
        canvasCtx.bezierCurveTo(P1.x, P1.y, P2.x, P2.y, P3.x, P3.y);
        canvasCtx.stroke();
        canvasCtx.restore();

        const NUM_VERTEBRAE = 14;
        for (let i = 0; i < NUM_VERTEBRAE; i++) {
          const t = i / (NUM_VERTEBRAE - 1);
          const pt = bezierPoint(t);
          const tang = bezierTangent(t);

          // Perpendicular direction to spine
          const nx = -tang.dy;
          const ny = tang.dx;

          // Vertebra size: wider at hips, narrower at neck
          const progress = i / (NUM_VERTEBRAE - 1); // 0 = hip, 1 = head
          const vW = (14 - progress * 6);  // width: 14px at hip → 8px at neck
          const vH = 4.5;                  // height along spine

          // Draw vertebra as rounded rect centered at pt, oriented along spine
          canvasCtx.save();
          canvasCtx.translate(pt.x, pt.y);
          canvasCtx.transform(tang.dx, tang.dy, nx, ny, 0, 0);
          canvasCtx.globalAlpha = 0.18;
          canvasCtx.fillStyle = spineColor;
          canvasCtx.beginPath();
          const r = Math.min(vW, vH) / 2;
          canvasCtx.roundRect(-vH / 2, -vW / 2, vH, vW, r);
          canvasCtx.fill();

          // Subtle outline for definition
          canvasCtx.globalAlpha = 0.08;
          canvasCtx.strokeStyle = spineColor;
          canvasCtx.lineWidth = 0.5;
          canvasCtx.stroke();
          canvasCtx.restore();
        }

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
        width: 1920,
        height: 1080,
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
