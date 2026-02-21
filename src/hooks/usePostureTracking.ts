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
}

interface UsePostureTrackingProps {
  sensitivity: number;
  onMetricsUpdate: (metrics: PostureMetrics) => void;
  privacyBlur: boolean;
}

export const usePostureTracking = ({
  sensitivity,
  onMetricsUpdate,
  privacyBlur,
}: UsePostureTrackingProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<Pose | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const baselineRef = useRef<Results | null>(null);
  const sensitivityRef = useRef(sensitivity);
  const privacyBlurRef = useRef(privacyBlur);
  const onMetricsUpdateRef = useRef(onMetricsUpdate);
  
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
      // Posture Analysis
      const landmarks = results.poseLandmarks;
      
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
        // sensitivity 1 = tolerant (großer Toleranzraum), 10 = streng (schneller negativ)
        const toleranceFactor = (10 - sens) / 9; // 1 bei Sens 1, 0 bei Sens 10
        
        // Z-Distanz: bei Sens 4–10 deutlich strenger (kleinere Abweichung = Alarm)
        const zThreshold = sens >= 4
          ? 1.05 + (10 - sens) * 0.008   // 1.05 (Sens 10) bis 1.098 (Sens 4)
          : 1.15 + 0.15 * toleranceFactor;      // Sens 1–3: wie bisher
        if (shoulderDist > bShoulderDist * zThreshold) isAlarm = true;
        if (shoulderHeight > bShoulderHeight + (0.03 + 0.07 * toleranceFactor)) isWarning = true;
        if (neckAngle < 150 - (25 * toleranceFactor)) isWarning = true;
      }

      // Throttle state updates to ~10fps to prevent render loops
      const now = Date.now();
      if (now - lastUpdateRef.current > 100) {
        onMetricsUpdateRef.current({
          neckAngle,
          screenDistance: shoulderDist,
          slouchFactor: shoulderHeight,
          isOptimal: !isWarning && !isAlarm,
          isWarning,
          isAlarm,
        });
        
        lastUpdateRef.current = now;
      }

      // Drawing Skeleton (always draw for smoothness)
      canvasCtx.globalAlpha = 0.4;
      canvasCtx.lineWidth = 0.5;
      
      // Default color: Apple Blue
      const baseColor = isAlarm ? '#FF3B30' : '#0A84FF';
      
      // Custom drawing to highlight problem zones
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
      if (err.name === 'NotReadableError' || err.message?.includes('in use')) {
        setError("Kamera wird bereits von einer anderen Anwendung verwendet.");
      } else {
        setError("Kamera konnte nicht gestartet werden: " + err.message);
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
