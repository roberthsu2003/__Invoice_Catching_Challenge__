/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vite/client" />
import { useEffect, useRef, useState, useCallback, MutableRefObject } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Settings, Terminal, FileText, MousePointer2, Keyboard, Volume2, VolumeX, Smartphone } from 'lucide-react';

import cloudImgUrl from './assets/images/雲端發票.png';
import electronicImgUrl from './assets/images/電子發票.png';
import receiptImgUrl from './assets/images/收據.jpg';
import logoImgUrl from './assets/images/logo.png';
import bgmUrl from './assets/audio/SoundHelix-Song-1.mp3';
import scoreSfxUrl from './assets/audio/pop.ogg';
import bombSfxUrl from './assets/audio/bomb.mp3';

interface FallingItem {
  id: number;
  x: number;
  y: number;
  type: 'CLOUD' | 'ELECTRONIC' | 'RECEIPT' | 'BOMB';
  speed: number;
  radius: number;
}

export default function App() {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'paused' | 'gameOver'>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(40);
  const [showSpeedWarning, setShowSpeedWarning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
    window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  );
  const [isMobile, setIsMobile] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerRect = useRef<DOMRect | null>(null);
  const requestRef = useRef<number>(null);
  
  // Audio Refs
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const scoreSfxRef = useRef<HTMLAudioElement | null>(null);
  const bombSfxRef = useRef<HTMLAudioElement | null>(null);

  // Asset Refs
  const cloudImgRef = useRef<HTMLImageElement | null>(null);
  const electronicImgRef = useRef<HTMLImageElement | null>(null);
  const receiptImgRef = useRef<HTMLImageElement | null>(null);

  // Game Objects Refs
  const playerX = useRef(0);
  const items = useRef<FallingItem[]>([]);
  const keys = useRef<{ [key: string]: boolean }>({});
  const lastSpawnTime = useRef(0);
  const currentId = useRef(0);
  const scoreRef = useRef(0);
  const timeLeftRef = useRef(40);

  // Audio Sources - Now using imported URLs
  const BGM_URL = bgmUrl;
  const SCORE_URL = scoreSfxUrl;
  const BOMB_URL = bombSfxUrl;

  // Web Audio Context for backup (incase local files fail)
  const audioCtx = useRef<AudioContext | null>(null);

  // Helper for synthesized SFX (Keeping as backup)
  const playSynthesizedSound = useCallback((type: 'score' | 'bomb') => {
    if (isMuted) return;
    try {
      if (!audioCtx.current) {
        audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtx.current;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'score') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(40, now + 0.3);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    } catch (e) {}
  }, [isMuted]);

  // Unified SFX player: Prefers local files, falls back to synthesized
  const playSfx = useCallback((audioRef: MutableRefObject<HTMLAudioElement | null>, type: 'score' | 'bomb') => {
    if (isMuted) return;
    if (audioRef.current && audioRef.current.readyState >= 2) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => playSynthesizedSound(type));
    } else {
      playSynthesizedSound(type);
    }
  }, [isMuted, playSynthesizedSound]);

  // Helper for SFX preloading
  const initSfx = useCallback((audioRef: MutableRefObject<HTMLAudioElement | null>, url: string) => {
    if (!audioRef.current) {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = 0.5;
      audio.muted = isMuted;
      audioRef.current = audio;
      // Don't play+pause here as it can block the UI thread during loading
    }
  }, [isMuted]);

  // Image Refs
  // Using DOM img tags natively below in order to guarantee loading without lifecycle GC issues.

  // Sync Mute State
  useEffect(() => {
    if (bgmRef.current) bgmRef.current.muted = isMuted;
    if (scoreSfxRef.current) scoreSfxRef.current.muted = isMuted;
    if (bombSfxRef.current) bombSfxRef.current.muted = isMuted;
  }, [isMuted]);

  // Initial Preload & Interaction Handler
  useEffect(() => {
    // Preload sounds when the app mounts
    initSfx(scoreSfxRef, SCORE_URL);
    initSfx(bombSfxRef, BOMB_URL);
    
    // Preload BGM but don't play yet
    if (!bgmRef.current) {
      const audio = new Audio(BGM_URL);
      audio.loop = true;
      audio.volume = 0.15;
      audio.muted = isMuted;
      audio.preload = 'auto';
      bgmRef.current = audio;
    }
  }, [isMuted, BGM_URL, SCORE_URL, BOMB_URL, initSfx]);

  // Unified Game Music Control
  useEffect(() => {
    const bgm = bgmRef.current;
    if (!bgm) return;

    if (gameState === 'playing') {
      bgm.play().catch(() => {});
    } else {
      // Pause music when not playing (Game Over or Menu)
      bgm.pause();
      if (gameState === 'menu' || gameState === 'gameOver') {
        bgm.currentTime = 0;
      }
    }
  }, [gameState]);

  // Initialize Game
  const resetGame = useCallback(() => {
    // 1. Force Resume Audio Context (unblocks synthesized sounds)
    try {
      if (!audioCtx.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) audioCtx.current = new AudioContextClass();
      }
      if (audioCtx.current && audioCtx.current.state === 'suspended') {
        audioCtx.current.resume();
      }
    } catch (e) {}

    // 2. Unlock/Prime all Audio elements on mobile (unblocks MP3 sounds)
    const primeAudio = (ref: MutableRefObject<HTMLAudioElement | null>) => {
      if (ref.current) {
        const audio = ref.current;
        // Playing and immediately pausing unblocks the audio channel on iOS/Android
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            if (ref !== bgmRef) {
              audio.pause();
              audio.currentTime = 0;
            }
          }).catch(() => {});
        }
      }
    };
    
    primeAudio(bgmRef);
    primeAudio(scoreSfxRef);
    primeAudio(bombSfxRef);
    
    // 3. Reset Game State
    setScore(0);
    scoreRef.current = 0;
    setTimeLeft(40);
    timeLeftRef.current = 40;
    items.current = [];
    lastSpawnTime.current = performance.now();
    
    if (containerRef.current) {
      containerRect.current = containerRef.current.getBoundingClientRect();
    }
    
    const initialWidth = containerRect.current?.width || window.innerWidth;
    playerX.current = initialWidth / 2;
    
    setGameState('playing');
  }, []);

  // Controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    const handleMouseMove = (e: MouseEvent) => {
      if (gameState === 'playing' && containerRect.current) {
        playerX.current = e.clientX - containerRect.current.left;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (gameState === 'playing' && containerRect.current && e.touches[0]) {
        playerX.current = e.touches[0].clientX - containerRect.current.left;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchstart', handleTouchMove, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchstart', handleTouchMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [gameState]);

  // Game Loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTime = performance.now();

    const animate = (time: number) => {
      // Delta time with a cap (max 50ms) to prevent logic jump on first frame or stutter
      const deltaTime = Math.min(50, time - lastTime);
      lastTime = time;

      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;

      // Clear the whole physical canvas first
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.scale(dpr, dpr);

      // Helper for rounded rectangle with fallback
      const fillRoundedRect = (x: number, y: number, width: number, height: number, radius: number) => {
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, width, height, radius);
        } else {
          ctx.moveTo(x + radius, y);
          ctx.lineTo(x + width - radius, y);
          ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
          ctx.lineTo(x + width, y + height - radius);
          ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
          ctx.lineTo(x + radius, y + height);
          ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
          ctx.lineTo(x, y + radius);
          ctx.quadraticCurveTo(x, y, x + radius, y);
          ctx.closePath();
        }
        ctx.fill();
      };

      // 1. Update Player
      const playerSpeed = 0.6 * deltaTime;
      if (keys.current['ArrowLeft'] || keys.current['KeyA']) playerX.current -= playerSpeed;
      if (keys.current['ArrowRight'] || keys.current['KeyD']) playerX.current += playerSpeed;

      // Bound Player
      const playerRadius = 40;
      if (playerX.current < playerRadius) playerX.current = playerRadius;
      if (playerX.current > cw - playerRadius) playerX.current = cw - playerRadius;

      // 2. Spawn Items
      const secondsElapsed = 40 - timeLeftRef.current;
      const timeSpeedMultiplier = secondsElapsed > 30 ? 1 + (secondsElapsed - 30) * 0.15 : 1;
      
      const spawnRate = Math.max(200, (1000 - scoreRef.current * 5) / timeSpeedMultiplier); 
      if (time - lastSpawnTime.current > spawnRate) {
        const rand = Math.random();
        let type: FallingItem['type'] = 'RECEIPT';
        if (rand < 0.15) type = 'CLOUD';
        else if (rand < 0.4) type = 'ELECTRONIC';
        else if (rand < 0.7) type = 'RECEIPT';
        else type = 'BOMB';

        items.current.push({
          id: currentId.current++,
          x: Math.random() * (cw - 60) + 30,
          y: -50,
          type,
          // Enforce minimum speed: base (0.15) + random variation, then scaled by multipliers
          speed: (Math.max(0.15, Math.random() * 0.2 + 0.1) * deltaTime + (scoreRef.current * 0.005)) * timeSpeedMultiplier,
          radius: 20
        });
        lastSpawnTime.current = time;
      }

      // 3. Update Items & Collision
      items.current = items.current.filter(item => {
        item.y += item.speed;

        // Collision Check
        const playerYOffset = window.innerWidth <= 768 || window.innerHeight < 750 ? 150 : 80;
        const dx = item.x - playerX.current;
        const dy = item.y - (ch - playerYOffset);
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < playerRadius + item.radius) {
          // Hit!
          if (item.type === 'BOMB') {
            setScore(prev => {
              const next = Math.max(0, prev - 5);
              scoreRef.current = next;
              return next;
            });
            playSfx(bombSfxRef, 'bomb');
          } else {
            let add = 1;
            if (item.type === 'CLOUD') add = 3;
            else if (item.type === 'ELECTRONIC') add = 2;
            
            setScore(prev => {
              const next = prev + add;
              scoreRef.current = next;
              return next;
            });
            playSfx(scoreSfxRef, 'score');
          }
          return false;
        }

        // Remove if off screen
        return item.y < ch + 50;
      });

      // 4. Draw
      // Clear already handled before save()
      
      // Draw Grid (Background)
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      for (let i = 0; i < cw; i += 50) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, ch); ctx.stroke();
      }
      for (let i = 0; i < ch; i += 50) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(cw, i); ctx.stroke();
      }

      // Draw Player
      const playerYOffset = window.innerWidth <= 768 || window.innerHeight < 750 ? 150 : 80;
      ctx.save();
      ctx.translate(playerX.current, ch - playerYOffset);
      
      // Draw a "Collector" character (Bucket)
      ctx.fillStyle = '#3B82F6';
      fillRoundedRect(-30, -10, 60, 40, 4);
      
      // Top lip
      ctx.fillStyle = '#60A5FA';
      ctx.fillRect(-35, -15, 70, 8);
      
      // Face
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(-10, 10, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(10, 10, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Draw Items
      items.current.forEach(item => {
        ctx.save();
        ctx.translate(item.x, item.y);

        if (item.type === 'CLOUD') {
          if (cloudImgRef.current && cloudImgRef.current.complete && cloudImgRef.current.naturalWidth > 0) {
            ctx.drawImage(cloudImgRef.current, -25, -25, 50, 50);
          } else {
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(0, 0, 15, 0, Math.PI * 2);
            ctx.arc(-10, 0, 10, 0, Math.PI * 2);
            ctx.arc(10, 0, 10, 0, Math.PI * 2);
            ctx.fill();
          }
          // Score Label
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          fillRoundedRect(-15, 30, 30, 18, 9);
          ctx.fillStyle = '#0369a1';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('+3', 0, 43);
        } else if (item.type === 'ELECTRONIC') {
          if (electronicImgRef.current && electronicImgRef.current.complete && electronicImgRef.current.naturalWidth > 0) {
            ctx.drawImage(electronicImgRef.current, -20, -30, 40, 60);
          } else {
            ctx.fillStyle = '#10b981';
            fillRoundedRect(-15, -20, 30, 40, 3);
          }
          // Score Label
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          fillRoundedRect(-15, 35, 30, 18, 9);
          ctx.fillStyle = '#065f46';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('+2', 0, 48);
        } else if (item.type === 'RECEIPT') {
          if (receiptImgRef.current && receiptImgRef.current.complete && receiptImgRef.current.naturalWidth > 0) {
            // Wider receipt image (60x40 for better visibility)
            ctx.drawImage(receiptImgRef.current, -30, -20, 60, 40);
          } else {
            ctx.fillStyle = '#f8fafc';
            fillRoundedRect(-30, -20, 60, 40, 1);
          }
          // Score Label
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          fillRoundedRect(-15, 30, 30, 18, 9);
          ctx.fillStyle = '#334155';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('+1', 0, 43);
        } else if (item.type === 'BOMB') {
          ctx.fillStyle = '#ef4444';
          ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
          // Fuse
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(10, -28); ctx.stroke();
          ctx.fillStyle = 'white';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('-5', 0, 5);
        }
        ctx.restore();
      });

      ctx.restore(); // Restore context scale
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState]); // Removed score dependency to prevent loop restart

  // High Score Persistence
  useEffect(() => {
    if (score > highScore) setHighScore(score);
  }, [score, highScore]);

  // Timer Countdown
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameState === 'playing') {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setGameState('gameOver');
            return 0;
          }
          const next = prev - 1;
          timeLeftRef.current = next;
          // Trigger warning once exactly at 10
          if (next === 10) {
            setShowSpeedWarning(true);
            setTimeout(() => setShowSpeedWarning(false), 2000);
          }
          return next;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState]); // Only depend on gameState, handle timer internally

  // Speed up warning cleanup
  useEffect(() => {
    if (gameState !== 'playing') {
      setShowSpeedWarning(false);
    }
  }, [gameState]);

  // Handle Resize & Mobile Detection
  useEffect(() => {
    const checkMobile = () => {
      // 偵測是否為移動裝置：檢查 User Agent 或是具備觸控功能
      const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      const isMobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      // 如果寬大於高（橫向）且高度小於 600 像素，通常是手機橫放的特徵
      const isSmallHeight = window.innerHeight < 600;
      
      // 判定為手機端：具備移動端 UA 或是 (具備觸控且視窗高度極小)
      setIsMobile(isMobileUA || (isTouchDevice && isSmallHeight));
    };
    checkMobile();

    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        containerRect.current = rect; // Update cached rect
        const dpr = window.devicePixelRatio || 1;
        canvasRef.current.width = rect.width * dpr;
        canvasRef.current.height = rect.height * dpr;
        canvasRef.current.style.width = `${rect.width}px`;
        canvasRef.current.style.height = `${rect.height}px`;

        // Update orientation state to force re-render
        setOrientation(rect.width > rect.height ? 'landscape' : 'portrait');
        checkMobile();
        
        // Adjust player position if it goes out of bounds
        if (playerX.current > rect.width) {
          playerX.current = rect.width - 40;
        } else if (playerX.current < 40) {
          playerX.current = 40;
        }
        
        if (playerX.current === 0) playerX.current = rect.width / 2;
      }
    };
    
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-100 text-slate-900 font-sans overflow-hidden select-none">
      <main className="flex-1 bg-white relative overflow-hidden flex flex-col">
        {/* Hidden Preload Assets */}
        <div style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0.01, zIndex: -1 }}>
          <img ref={cloudImgRef} src={cloudImgUrl} alt="cloud" />
          <img ref={electronicImgRef} src={electronicImgUrl} alt="electronic" />
          <img ref={receiptImgRef} src={receiptImgUrl} alt="receipt" />
        </div>
        {/* Logo Container */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <img 
            src={logoImgUrl} 
            alt="logo" 
            className="h-8 md:h-12 w-auto object-contain"
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        </div>

        {/* Promotional Badge - Only visible on menu */}
        <AnimatePresence>
          {gameState === 'menu' && (
            <div className="absolute top-12 md:top-16 left-1/2 -translate-x-1/2 z-30 text-center pointer-events-none w-full max-w-lg px-4 transition-all">
              <motion.div 
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                transition={{ duration: 0.8, type: 'spring', bounce: 0.4 }}
                className="bg-gradient-to-br from-orange-500 via-orange-600 to-amber-500 text-white p-8 md:p-12 rounded-[2.5rem] md:rounded-[3rem] shadow-[0_20px_50px_rgba(249,115,22,0.4)] border-4 border-white shadow-orange-500/20 relative overflow-hidden scale-90 md:scale-100 origin-top"
              >
                <div className="absolute inset-0 bg-white/10 pointer-events-none" />
                <p className="text-sm md:text-lg font-bold uppercase tracking-[0.2em] mb-2 md:mb-3 opacity-95 drop-shadow-sm">500元雲端發票專屬獎</p>
                <p className="text-3xl md:text-5xl font-black tracking-tighter drop-shadow-[0_4px_4px_rgba(0,0,0,0.25)] flex items-center justify-center gap-3 leading-tight mb-4 md:mb-6">
                  再增 <span className="text-yellow-300 text-4xl md:text-7xl underline decoration-orange-400 decoration-8 underline-offset-8">70萬組</span>
                </p>
                <div className="inline-flex items-center gap-2 px-6 md:px-8 py-2 md:py-3 bg-white/10 rounded-full border border-white/20 backdrop-blur-sm shadow-inner group">
                  <span className="text-xs md:text-xl font-medium tracking-wide flex items-center gap-2">
                    總組數變更：
                    <span className="text-white/60 line-through decoration-white/40 decoration-2">245萬組</span>
                    <span className="text-yellow-200 text-lg md:text-2xl font-black italic">➤</span>
                    <span className="text-yellow-300 font-black text-base md:text-3xl drop-shadow-sm">315萬組</span>
                  </span>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div ref={containerRef} className="flex-1 relative touch-none">
          <canvas ref={canvasRef} className="block cursor-none bg-slate-50 touch-none" />
          
          <AnimatePresence>
            {gameState === 'menu' && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-white flex justify-center p-6 text-center z-10"
              >
                <motion.div 
                  initial={{ y: 20, opacity: 0 }} 
                  animate={{ y: 0, opacity: 1 }} 
                  className="pt-64 md:pt-80 lg:pt-[24rem] flex flex-col items-center"
                >
                  <h1 className="text-3xl md:text-6xl font-black text-slate-900 mb-0.5 md:mb-1 tracking-tighter uppercase italic">
                    發票接物<span className="text-blue-600">挑戰</span>
                  </h1>
                  <p className="text-slate-400 text-[10px] md:text-xs mb-2 md:mb-8 tracking-widest uppercase font-bold">Invoice Catching Challenge v2.0</p>
                  
                  <div className="grid grid-cols-2 gap-2 md:gap-4 max-w-xl mx-auto mb-4 md:mb-8">
                     <div className="bg-white p-2 md:p-4 rounded-xl border border-slate-200 text-left shadow-lg scale-90 md:scale-100 origin-center">
                        <div className="flex items-center gap-2 mb-1 md:mb-2 text-blue-600">
                           <Keyboard size={18} className="md:w-6 md:h-6" /> <span className="text-sm md:text-xl font-bold uppercase tracking-wider">控制</span>
                        </div>
                        <p className="text-slate-600 text-[10px] md:text-base">滑鼠移動或鍵盤左右鍵控制。</p>
                     </div>
                     <div className="bg-slate-50 p-2 md:p-4 rounded-xl border border-slate-200 text-left shadow-lg scale-90 md:scale-100 origin-center">
                        <div className="flex items-center gap-2 mb-1 md:mb-2 text-emerald-600">
                           <MousePointer2 size={18} className="md:w-6 md:h-6" /> <span className="text-sm md:text-xl font-bold uppercase tracking-wider">遊戲任務</span>
                        </div>
                        <p className="text-slate-600 text-[10px] md:text-base">接發票得分，避開炸彈扣分。</p>
                     </div>
                  </div>

                  <button 
                    onClick={resetGame}
                    className="group relative px-10 md:px-12 py-3 md:py-5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-2xl shadow-blue-500/40 overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-white/10 -translate-x-full group-hover:translate-x-0 transition-transform duration-500 skew-x-12" />
                    <span className="relative flex items-center gap-3 text-2xl">
                      <Play fill="currentColor" size={32} /> 開始遊戲
                    </span>
                  </button>
                </motion.div>
              </motion.div>
            )}
            {gameState === 'gameOver' && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900 flex items-center justify-center p-6 text-center z-50 text-white"
              >
                <motion.div 
                  initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
                  className="max-w-md w-full"
                >
                  <div className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-red-500/50">
                    <Terminal size={48} className="text-white" />
                  </div>
                  
                  <h2 className="text-5xl font-black mb-2 tracking-tighter italic uppercase text-red-500">遊戲結束</h2>
                  <p className="text-slate-400 mb-8 font-medium">挑戰完成！你的節稅成果如下：</p>
                  
                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">最終得分</p>
                      <p className="text-4xl font-black text-white">{score}</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">最高紀錄</p>
                      <p className="text-4xl font-black text-yellow-500">{highScore}</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={resetGame}
                      className="w-full py-5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl transition-all active:scale-95 text-xl flex items-center justify-center gap-3 shadow-xl shadow-blue-600/30"
                    >
                      <RotateCcw size={24} /> 再玩一次
                    </button>
                    <button 
                      onClick={() => setGameState('menu')}
                      className="w-full py-4 bg-white/5 hover:bg-white/10 text-slate-300 font-bold rounded-2xl transition-all"
                    >
                      返回主選單
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* In-game HUD overlay */}
          {gameState !== 'menu' && (
            <>
              <div className="absolute top-4 right-4 flex gap-2 z-20">
                <button 
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-2 bg-white/80 rounded border border-slate-300 text-slate-800 hover:bg-slate-100 transition-colors shadow-sm"
                >
                  {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <button 
                  onClick={() => setGameState(gameState === 'playing' ? 'paused' : 'playing')}
                  className="p-2 bg-white/80 rounded border border-slate-300 text-slate-800 hover:bg-slate-100 transition-colors shadow-sm"
                >
                  {gameState === 'playing' ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
                </button>
                <button 
                  onClick={() => { setGameState('menu'); setScore(0); }}
                  className="p-2 bg-white/60 backdrop-blur-md rounded border border-slate-300 text-slate-800 hover:bg-slate-100 transition-colors shadow-sm"
                >
                  <RotateCcw size={18} />
                </button>
              </div>

              <div className="absolute top-4 left-4 pointer-events-none z-20 space-y-2">
                <div className="bg-white/90 backdrop-blur-md px-5 py-3 rounded-2xl border border-slate-200 shadow-xl flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-inner">
                    <Play size={20} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-[10px] uppercase font-bold tracking-[2px] mb-0.5">目前得分</p>
                    <p className="text-3xl font-black text-slate-900 leading-none tabular-nums">{score}</p>
                  </div>
                </div>

                <div className={`bg-white/90 backdrop-blur-md px-5 py-3 rounded-2xl border ${timeLeft <= 10 ? 'border-red-500 shadow-red-200' : 'border-slate-200'} shadow-xl transition-colors duration-300 flex items-center gap-4`}>
                  <div className={`w-10 h-10 ${timeLeft <= 10 ? 'bg-red-500' : 'bg-slate-900'} rounded-xl flex items-center justify-center text-white shadow-inner`}>
                    <RotateCcw size={20} />
                  </div>
                  <div>
                    <p className="text-slate-400 text-[10px] uppercase font-bold tracking-[2px] mb-0.5">剩餘時間</p>
                    <p className={`text-3xl font-black ${timeLeft <= 10 ? 'text-red-500 underline decoration-red-500 underline-offset-4' : 'text-slate-900'} leading-none tabular-nums`}>{timeLeft} 秒</p>
                  </div>
                </div>
              </div>

              {/* Acceleration Warning */}
              <AnimatePresence>
                {showSpeedWarning && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ 
                      opacity: [0.4, 1, 0.4], 
                      scale: [0.9, 1.1, 0.9],
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                    className="absolute inset-x-0 top-1/3 flex flex-col items-center justify-center pointer-events-none z-30"
                  >
                    <div className="bg-red-600 text-white px-8 py-3 rounded-full shadow-[0_0_30px_rgba(220,38,38,0.5)] border-4 border-white transform -rotate-3">
                      <p className="text-4xl md:text-6xl font-black uppercase tracking-tighter italic">加速中...</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {gameState === 'paused' && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-30"
            >
              <div className="bg-white p-10 rounded-2xl border border-slate-200 shadow-2xl text-center">
                <h2 className="text-3xl font-black text-slate-900 mb-8">遊戲暫停</h2>
                <div className="flex flex-col gap-4">
                  <button onClick={() => setGameState('playing')} className="px-12 py-4 bg-blue-600 text-white rounded-xl font-bold text-xl shadow-lg hover:bg-blue-700 transition-colors">繼續</button>
                  <button onClick={() => setGameState('menu')} className="px-12 py-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-xl border border-slate-300 hover:bg-slate-200 transition-colors">返回主選單</button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {/* Orientation Lock Overlay - Only for Mobile */}
      <AnimatePresence>
        {isMobile && orientation === 'landscape' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#0c1222] flex items-center justify-center p-4 overflow-hidden"
          >
            {/* Outer Frame Border */}
            <div className="absolute inset-4 border-2 border-blue-500/30 rounded-sm pointer-events-none" />
            
            <div className="flex flex-col items-center justify-center text-center max-w-lg">
              <motion.div
                animate={{ 
                  rotate: [-10, 80, -10],
                  scale: [1, 1.05, 1]
                }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                className="mb-10 w-32 h-32 bg-blue-600 rounded-[2rem] shadow-[0_0_50px_rgba(37,99,235,0.4)] flex items-center justify-center rotate-[-15deg]"
              >
                <Smartphone size={64} className="text-white" />
              </motion.div>
              
              <h2 className="text-4xl md:text-5xl font-black text-white mb-6 tracking-tight">請旋轉您的裝置</h2>
              
              <div className="space-y-1">
                <p className="text-slate-400 text-lg md:text-xl font-medium">本遊戲僅支援直向模式，請將手機旋轉為直向</p>
                <p className="text-slate-400 text-lg md:text-xl font-medium">以獲得最佳遊戲體驗。</p>
              </div>
              
              <div className="mt-16 flex items-center gap-3 text-blue-500 font-bold tracking-widest text-sm">
                <RotateCcw size={20} className="animate-spin" />
                <span>正在等待旋轉...</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
