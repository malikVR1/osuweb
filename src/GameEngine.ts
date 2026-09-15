import { OsuMap, HitObject, GameState, HitResult } from './types';
import { getApproachTime, getCircleRadius, getHitWindow } from './osuParser';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface BackgroundStar {
  x: number;
  y: number;
  size: number;
  speed: number;
  brightness: number;
}

interface SliderState {
  objectIndex: number;
  startTime: number;
  endTime: number;
  isTracking: boolean;
  ticksHit: number;
  totalTicks: number;
  lastTickTime: number;
  completed: boolean;
  failed: boolean;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map: OsuMap;
  private audioCtx: AudioContext;
  private audioBuffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startTime: number = 0;
  private isPlaying: boolean = false;
  private animationId: number = 0;
  private hitObjects: HitObject[] = [];
  private state: GameState;
  private results: HitResult[] = [];
  private cursorPos: { x: number; y: number } = { x: 256, y: 192 };
  private cursorPressed: boolean = false;
  private approachTime: number;
  private circleRadius: number;
  private hitWindow300: number;
  private hitWindow100: number;
  private hitWindow50: number;
  private onStateChange: (state: GameState) => void;
  private onEnd: (state: GameState, results: HitResult[]) => void;
  private objectStates: Map<number, { hit: boolean; result?: string; resultTime?: number }> = new Map();
  private activeSliders: Map<number, SliderState> = new Map();
  private scale: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private playfieldWidth: number = 512;
  private playfieldHeight: number = 384;
  private comboColors: string[] = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
  private particles: Particle[] = [];
  private hitErrors: number[] = [];
  private bgStars: BackgroundStar[] = [];
  private frameCount: number = 0;
  private boundResize: () => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;

  constructor(
    canvas: HTMLCanvasElement,
    map: OsuMap,
    audioBuffer: AudioBuffer | null,
    onStateChange: (state: GameState) => void,
    onEnd: (state: GameState, results: HitResult[]) => void
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.map = map;
    this.audioBuffer = audioBuffer;
    this.onStateChange = onStateChange;
    this.onEnd = onEnd;

    this.audioCtx = new AudioContext();

    this.approachTime = getApproachTime(map.approachRate);
    this.circleRadius = getCircleRadius(map.circleSize);
    this.hitWindow300 = getHitWindow(map.overallDifficulty, '300');
    this.hitWindow100 = getHitWindow(map.overallDifficulty, '100');
    this.hitWindow50 = getHitWindow(map.overallDifficulty, '50');

    this.hitObjects = [...map.hitObjects].sort((a, b) => a.time - b.time);
    this.assignComboNumbers();

    this.state = {
      score: 0,
      combo: 0,
      maxCombo: 0,
      hits300: 0,
      hits100: 0,
      hits50: 0,
      misses: 0,
      accuracy: 100,
      health: 1,
    };

    // Initialize background stars
    for (let i = 0; i < 50; i++) {
      this.bgStars.push({
        x: Math.random() * 512,
        y: Math.random() * 384,
        size: 1 + Math.random() * 2,
        speed: 0.2 + Math.random() * 0.5,
        brightness: 0.3 + Math.random() * 0.7,
      });
    }

    // Bind event handlers
    this.boundResize = this.resize.bind(this);
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);

    this.setupInput();
    this.resize();
  }

  private assignComboNumbers() {
    let comboNum = 0;
    let newCombo = true;
    for (const obj of this.hitObjects) {
      if (obj.isSpinner) {
        newCombo = true;
        continue;
      }
      if (newCombo || (obj.type & 4) !== 0) {
        comboNum = (comboNum + 1) % this.comboColors.length;
        newCombo = false;
      }
      obj.comboNumber = comboNum;
    }
  }

  private resize() {
    const container = this.canvas.parentElement;
    if (!container) return;
    
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    this.canvas.width = containerWidth;
    this.canvas.height = containerHeight;

    const scaleX = containerWidth / this.playfieldWidth;
    const scaleY = containerHeight / this.playfieldHeight;
    this.scale = Math.min(scaleX, scaleY);
    
    this.offsetX = (containerWidth - this.playfieldWidth * this.scale) / 2;
    this.offsetY = (containerHeight - this.playfieldHeight * this.scale) / 2;
  }

  private setupInput() {
    window.addEventListener('resize', this.boundResize);
    this.canvas.addEventListener('mousemove', this.boundMouseMove);
    this.canvas.addEventListener('mousedown', this.boundMouseDown);
    this.canvas.addEventListener('mouseup', this.boundMouseUp);
    this.canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.boundTouchEnd, { passive: false });
    document.addEventListener('keydown', this.boundKeyDown);
    document.addEventListener('keyup', this.boundKeyUp);
  }

  private screenToPlayfield(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = (screenX - rect.left - this.offsetX) / this.scale;
    const y = (screenY - rect.top - this.offsetY) / this.scale;
    return { x, y };
  }

  private playfieldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: x * this.scale + this.offsetX,
      y: y * this.scale + this.offsetY,
    };
  }

  private handleMouseMove(e: MouseEvent) {
    this.cursorPos = this.screenToPlayfield(e.clientX, e.clientY);
  }

  private handleMouseDown(e: MouseEvent) {
    if (!this.isPlaying) return;
    this.cursorPressed = true;
    this.cursorPos = this.screenToPlayfield(e.clientX, e.clientY);
    this.checkHit();
  }

  private handleMouseUp(_e: MouseEvent) {
    this.cursorPressed = false;
    this.checkSliderRelease();
  }

  private handleTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (!this.isPlaying) return;
    const touch = e.touches[0];
    this.cursorPressed = true;
    this.cursorPos = this.screenToPlayfield(touch.clientX, touch.clientY);
    this.checkHit();
  }

  private handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    const touch = e.touches[0];
    this.cursorPos = this.screenToPlayfield(touch.clientX, touch.clientY);
  }

  private handleTouchEnd(e: TouchEvent) {
    e.preventDefault();
    this.cursorPressed = false;
    this.checkSliderRelease();
  }

  private handleKeyDown(e: KeyboardEvent) {
    if ((e.key === 'z' || e.key === 'x' || e.key === 'Z' || e.key === 'X') && !this.cursorPressed) {
      this.cursorPressed = true;
      this.checkHit();
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    if (e.key === 'z' || e.key === 'x' || e.key === 'Z' || e.key === 'X') {
      this.cursorPressed = false;
      this.checkSliderRelease();
    }
  }

  private getCurrentTime(): number {
    if (!this.isPlaying) return 0;
    return (this.audioCtx.currentTime - this.startTime) * 1000;
  }

  private checkHit() {
    const currentTime = this.getCurrentTime();
    
    for (let i = 0; i < this.hitObjects.length; i++) {
      const obj = this.hitObjects[i];
      // Handle both circles and sliders
      if (!obj.isCircle && !obj.isSlider) continue;
      if (this.objectStates.get(i)?.hit) continue;
      
      const timeDiff = Math.abs(currentTime - obj.time);
      
      if (timeDiff > this.hitWindow50) continue;
      
      // Check distance
      const dx = this.cursorPos.x - obj.x;
      const dy = this.cursorPos.y - obj.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > this.circleRadius + 15) continue;
      
      // Hit!
      this.objectStates.set(i, { hit: true, result: undefined, resultTime: currentTime });
      
      let judgment: '300' | '100' | '50';
      if (timeDiff <= this.hitWindow300) {
        judgment = '300';
        this.state.hits300++;
      } else if (timeDiff <= this.hitWindow100) {
        judgment = '100';
        this.state.hits100++;
      } else {
        judgment = '50';
        this.state.hits50++;
      }
      
      // Score calculation
      const baseScore = judgment === '300' ? 300 : judgment === '100' ? 100 : 50;
      this.state.score += Math.floor(baseScore * (1 + this.state.combo * 0.05));
      
      this.state.combo++;
      this.state.maxCombo = Math.max(this.state.maxCombo, this.state.combo);
      this.state.health = Math.min(1, this.state.health + 0.02);
      
      this.results.push({ time: currentTime, judgment, x: obj.x, y: obj.y });
      this.hitErrors.push(currentTime - obj.time);
      
      // Spawn particles
      this.spawnParticles(obj.x, obj.y, judgment);
      
      // If it's a slider, start tracking
      if (obj.isSlider && obj.endTime) {
        this.startSliderTracking(i, currentTime, obj.endTime);
      }
      
      this.updateAccuracy();
      this.onStateChange({ ...this.state });
      break;
    }
  }

  private startSliderTracking(objectIndex: number, startTime: number, endTime: number) {
    const obj = this.hitObjects[objectIndex];
    const sliderDuration = endTime - obj.time;
    
    // Calculate number of ticks based on slider length and tick rate
    const tickInterval = sliderDuration / (this.map.sliderTickRate * (obj.slides || 1));
    const totalTicks = Math.floor(sliderDuration / tickInterval);
    
    this.activeSliders.set(objectIndex, {
      objectIndex,
      startTime,
      endTime,
      isTracking: true,
      ticksHit: 0,
      totalTicks,
      lastTickTime: startTime,
      completed: false,
      failed: false,
    });
  }

  private checkSliderRelease() {
    const currentTime = this.getCurrentTime();
    
    for (const [index, slider] of this.activeSliders.entries()) {
      if (!slider.isTracking || slider.completed || slider.failed) continue;
      
      // If button released before slider ends, fail the slider
      if (currentTime < slider.endTime) {
        slider.failed = true;
        slider.isTracking = false;
        this.state.combo = 0;
        this.state.misses++;
        this.state.health = Math.max(0, this.state.health - 0.1);
        this.results.push({ time: currentTime, judgment: 'miss', x: 0, y: 0 });
        this.updateAccuracy();
        this.onStateChange({ ...this.state });
      }
    }
  }

  private updateActiveSliders(currentTime: number) {
    for (const [index, slider] of this.activeSliders.entries()) {
      if (!slider.isTracking || slider.completed || slider.failed) continue;
      
      const obj = this.hitObjects[index];
      if (!obj.endTime) continue;
      
      // Check if slider is complete
      if (currentTime >= slider.endTime) {
        slider.completed = true;
        slider.isTracking = false;
        
        // Award points for completing the slider
        const tickScore = 30;
        this.state.score += tickScore * slider.ticksHit;
        
        // Bonus for completing
        this.state.score += 100;
        
        this.updateAccuracy();
        this.onStateChange({ ...this.state });
        continue;
      }
      
      // Calculate current ball position
      const sliderDuration = obj.endTime - obj.time;
      if (sliderDuration <= 0) continue; // Safety check
      const progress = (currentTime - obj.time) / sliderDuration;
      const ballPos = this.calculateSliderPosition(obj, progress);
      
      // Safety check for ballPos
      if (!ballPos || isNaN(ballPos.x) || isNaN(ballPos.y)) continue;
      
      // Check if cursor is near the ball
      const dx = this.cursorPos.x - ballPos.x;
      const dy = this.cursorPos.y - ballPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // Check for ticks
      const tickInterval = (obj.endTime - obj.time) / (this.map.sliderTickRate * (obj.slides || 1));
      const timeSinceLastTick = currentTime - slider.lastTickTime;
      
      if (timeSinceLastTick >= tickInterval) {
        // Check if cursor is following the ball
        if (dist < this.circleRadius * 1.5 && this.cursorPressed) {
          slider.ticksHit++;
          slider.lastTickTime = currentTime;
          
          // Small score for each tick
          this.state.score += 10;
          
          // Spawn small particles
          this.spawnSmallParticles(ballPos.x, ballPos.y);
        } else {
          // Failed to follow - slider fails
          slider.failed = true;
          slider.isTracking = false;
          this.state.combo = 0;
          this.state.misses++;
          this.state.health = Math.max(0, this.state.health - 0.1);
          this.results.push({ time: currentTime, judgment: 'miss', x: ballPos.x, y: ballPos.y });
          this.updateAccuracy();
          this.onStateChange({ ...this.state });
        }
      }
    }
  }

  private spawnSmallParticles(x: number, y: number) {
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI * 2 * i) / 4;
      const speed = 1 + Math.random() * 2;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5,
        maxLife: 0.5,
        color: '#FFFFFF',
        size: 2 + Math.random() * 2,
      });
    }
  }

  private spawnParticles(x: number, y: number, judgment: string) {
    const color = judgment === '300' ? '#66CCFF' : judgment === '100' ? '#88B300' : '#FFAA00';
    const count = judgment === '300' ? 16 : 10;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 2 + Math.random() * 4;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 1,
        color,
        size: 3 + Math.random() * 5,
      });
    }
    
    // Play hit sound
    this.playHitSound(judgment);
  }

  private playHitSound(judgment: string) {
    const ctx = this.audioCtx;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    if (judgment === '300') {
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
    } else if (judgment === '100') {
      oscillator.frequency.value = 600;
      oscillator.type = 'sine';
    } else {
      oscillator.frequency.value = 400;
      oscillator.type = 'triangle';
    }
    
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.1);
  }

  private updateAccuracy() {
    const total = this.state.hits300 + this.state.hits100 + this.state.hits50 + this.state.misses;
    if (total === 0) {
      this.state.accuracy = 100;
      return;
    }
    this.state.accuracy = (
      (this.state.hits300 * 300 + this.state.hits100 * 100 + this.state.hits50 * 50) /
      (total * 300)
    ) * 100;
  }

  start() {
    if (this.audioBuffer) {
      this.source = this.audioCtx.createBufferSource();
      this.source.buffer = this.audioBuffer;
      this.source.connect(this.audioCtx.destination);
      this.source.start();
      this.startTime = this.audioCtx.currentTime;
    } else {
      this.startTime = this.audioCtx.currentTime;
    }
    
    this.isPlaying = true;
    this.gameLoop();
  }

  stop() {
    this.isPlaying = false;
    if (this.source) {
      try { this.source.stop(); } catch (_e) { /* ignore */ }
    }
    cancelAnimationFrame(this.animationId);
  }

  private gameLoop = () => {
    if (!this.isPlaying) return;
    
    const currentTime = this.getCurrentTime();
    this.frameCount++;
    
    // Check for misses (circles only)
    for (let i = 0; i < this.hitObjects.length; i++) {
      const obj = this.hitObjects[i];
      if (!obj.isCircle) continue;
      if (this.objectStates.get(i)?.hit) continue;
      
      if (currentTime > obj.time + this.hitWindow50) {
        this.objectStates.set(i, { hit: true, result: 'miss', resultTime: currentTime });
        this.state.combo = 0;
        this.state.misses++;
        this.state.health = Math.max(0, this.state.health - 0.05);
        this.results.push({ time: currentTime, judgment: 'miss', x: obj.x, y: obj.y });
        this.updateAccuracy();
        this.onStateChange({ ...this.state });
      }
    }

    // Update active sliders
    this.updateActiveSliders(currentTime);

    // Check if map is finished
    const lastObject = this.hitObjects[this.hitObjects.length - 1];
    if (lastObject) {
      const endTime = (lastObject.endTime || lastObject.time) + 2000;
      if (currentTime > endTime) {
        this.isPlaying = false;
        this.onEnd({ ...this.state }, this.results);
        return;
      }
    }

    this.render(currentTime);
    this.animationId = requestAnimationFrame(this.gameLoop);
  }

  private render(currentTime: number) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Background
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    bgGrad.addColorStop(0, '#1a1a3e');
    bgGrad.addColorStop(1, '#0a0a1a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Background stars
    this.renderBackground(ctx, currentTime);

    // Playfield area
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.offsetX, this.offsetY, 
      this.playfieldWidth * this.scale, 
      this.playfieldHeight * this.scale);
    ctx.clip();

    // Draw objects
    this.renderObjects(currentTime);

    // Draw particles
    this.updateAndDrawParticles();

    // Draw cursor
    this.drawCursor();

    ctx.restore();

    // Draw combo (outside clip)
    if (this.state.combo > 2) {
      this.drawCombo();
    }

    // Hit error bar
    this.drawHitErrorBar();
  }

  private renderBackground(ctx: CanvasRenderingContext2D, currentTime: number) {
    for (const star of this.bgStars) {
      star.y += star.speed;
      if (star.y > 384) {
        star.y = 0;
        star.x = Math.random() * 512;
      }
      
      const pos = this.playfieldToScreen(star.x, star.y);
      const pulse = 0.5 + 0.5 * Math.sin(currentTime * 0.002 + star.x);
      const alpha = star.brightness * pulse * 0.4;
      
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, star.size * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();
    }
  }

  private renderObjects(currentTime: number) {
    const ctx = this.ctx;

    // Collect visible objects
    const visibleObjects: { obj: HitObject; index: number }[] = [];
    
    for (let i = 0; i < this.hitObjects.length; i++) {
      const obj = this.hitObjects[i];
      const objState = this.objectStates.get(i);
      
      if (objState?.hit) {
        if (objState.resultTime && currentTime - objState.resultTime < 600) {
          if (objState.result === 'miss') {
            this.drawMissEffect(obj.x, obj.y, currentTime - objState.resultTime);
          } else {
            const elapsed = currentTime - objState.resultTime;
            this.drawHitEffect(obj.x, obj.y, objState.result || '300', elapsed);
          }
        }
        continue;
      }
      
      const timeUntilHit = obj.time - currentTime;
      if (timeUntilHit > this.approachTime + 100) continue;
      if (timeUntilHit < -this.hitWindow50 - 300) continue;
      
      visibleObjects.push({ obj, index: i });
    }

    // Draw in reverse order (bottom to top)
    for (let i = visibleObjects.length - 1; i >= 0; i--) {
      const { obj } = visibleObjects[i];
      if (obj.isCircle) {
        this.drawHitCircle(obj, currentTime);
      } else if (obj.isSlider) {
        this.drawSlider(obj, currentTime);
      } else if (obj.isSpinner) {
        this.drawSpinner(obj, currentTime);
      }
    }
  }

  private drawHitCircle(obj: HitObject, currentTime: number) {
    const ctx = this.ctx;
    const timeUntilHit = obj.time - currentTime;
    const progress = Math.max(0, Math.min(1, 1 - (timeUntilHit / this.approachTime)));
    
    const pos = this.playfieldToScreen(obj.x, obj.y);
    const radius = this.circleRadius * this.scale;
    const approachRadius = radius + radius * 2.5 * (1 - progress);

    const comboColor = this.comboColors[obj.comboNumber || 0];

    // Glow effect
    const glowGrad = ctx.createRadialGradient(pos.x, pos.y, radius * 0.5, pos.x, pos.y, radius * 1.5);
    glowGrad.addColorStop(0, comboColor + '20');
    glowGrad.addColorStop(1, comboColor + '00');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // Approach circle
    if (progress < 1) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, approachRadius, 0, Math.PI * 2);
      ctx.strokeStyle = comboColor;
      ctx.lineWidth = Math.max(2, 3 * this.scale);
      ctx.stroke();
    }

    // Hit circle body - outer ring
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = comboColor + '30';
    ctx.fill();

    // Hit circle body - gradient fill
    const bodyGrad = ctx.createRadialGradient(pos.x - radius * 0.3, pos.y - radius * 0.3, 0, pos.x, pos.y, radius);
    bodyGrad.addColorStop(0, comboColor + 'CC');
    bodyGrad.addColorStop(0.6, comboColor + '88');
    bodyGrad.addColorStop(1, comboColor + '44');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, 3 * this.scale);
    ctx.stroke();

    // Inner highlight
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fill();
  }

  private drawSlider(obj: HitObject, currentTime: number) {
    const ctx = this.ctx;
    
    // If no curve points, just draw as a circle
    if (!obj.curvePoints || obj.curvePoints.length === 0) {
      this.drawHitCircle(obj, currentTime);
      return;
    }

    const pos = this.playfieldToScreen(obj.x, obj.y);
    const radius = this.circleRadius * this.scale;
    const comboColor = this.comboColors[obj.comboNumber || 0];
    const objIndex = this.hitObjects.indexOf(obj);
    const objState = this.objectStates.get(objIndex);
    const sliderState = this.activeSliders.get(objIndex);

    // Draw slider path shadow
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    for (const point of obj.curvePoints) {
      const p = this.playfieldToScreen(point.x, point.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = radius * 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Draw slider path with combo color
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    for (const point of obj.curvePoints) {
      const p = this.playfieldToScreen(point.x, point.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = comboColor + '40';
    ctx.lineWidth = radius * 2;
    ctx.stroke();

    // Slider border
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    for (const point of obj.curvePoints) {
      const p = this.playfieldToScreen(point.x, point.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = comboColor + '80';
    ctx.lineWidth = radius * 2 + 4;
    ctx.stroke();

    // Draw slider ball if slider is being tracked
    if (objState?.hit && !objState.result && obj.endTime && sliderState?.isTracking) {
      const sliderDuration = obj.endTime - obj.time;
      if (sliderDuration > 0) {
        const sliderProgress = Math.max(0, Math.min(1, (currentTime - obj.time) / sliderDuration));
        const ballPos = this.calculateSliderPosition(obj, sliderProgress);
        const ballScreenPos = this.playfieldToScreen(ballPos.x, ballPos.y);
        
        // Draw slider ball
        ctx.beginPath();
        ctx.arc(ballScreenPos.x, ballScreenPos.y, radius * 0.8, 0, Math.PI * 2);
        const ballGrad = ctx.createRadialGradient(
          ballScreenPos.x, ballScreenPos.y, 0,
          ballScreenPos.x, ballScreenPos.y, radius * 0.8
        );
        ballGrad.addColorStop(0, '#FFFFFF');
        ballGrad.addColorStop(0.5, comboColor);
        ballGrad.addColorStop(1, comboColor + '80');
        ctx.fillStyle = ballGrad;
        ctx.fill();
        
        // Ball glow
        ctx.beginPath();
        ctx.arc(ballScreenPos.x, ballScreenPos.y, radius * 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = comboColor;
        ctx.lineWidth = 3 * this.scale;
        ctx.stroke();

        // Draw trail effect
        const trailLength = 5;
        for (let i = 1; i <= trailLength; i++) {
          const trailProgress = Math.max(0, sliderProgress - i * 0.02);
          const trailPos = this.calculateSliderPosition(obj, trailProgress);
          const trailScreenPos = this.playfieldToScreen(trailPos.x, trailPos.y);
          
          ctx.beginPath();
          ctx.arc(trailScreenPos.x, trailScreenPos.y, radius * 0.6 * (1 - i / trailLength), 0, Math.PI * 2);
          ctx.fillStyle = comboColor + Math.floor((1 - i / trailLength) * 100).toString(16).padStart(2, '0');
          ctx.fill();
        }
      }
    }

    // Start circle
    this.drawHitCircle(obj, currentTime);
  }

  private calculateSliderPosition(obj: HitObject, progress: number): { x: number; y: number } {
    if (!obj.curvePoints || obj.curvePoints.length === 0) {
      return { x: obj.x, y: obj.y };
    }

    // Clamp progress to [0, 1] to avoid negative indices
    progress = Math.max(0, Math.min(1, progress));

    // Simple linear interpolation along the path
    const totalSegments = obj.curvePoints.length;
    const segmentProgress = progress * totalSegments;
    const segmentIndex = Math.floor(segmentProgress);
    const segmentT = segmentProgress - segmentIndex;

    if (segmentIndex >= totalSegments) {
      const lastPoint = obj.curvePoints[totalSegments - 1];
      return { x: lastPoint.x, y: lastPoint.y };
    }

    const startPoint = segmentIndex === 0 ? { x: obj.x, y: obj.y } : obj.curvePoints[segmentIndex - 1];
    const endPoint = obj.curvePoints[segmentIndex];

    // Safety check
    if (!startPoint || !endPoint) {
      return { x: obj.x, y: obj.y };
    }

    return {
      x: startPoint.x + (endPoint.x - startPoint.x) * segmentT,
      y: startPoint.y + (endPoint.y - startPoint.y) * segmentT,
    };
  }

  private drawSpinner(obj: HitObject, currentTime: number) {
    const ctx = this.ctx;
    const centerX = this.playfieldToScreen(256, 192);
    const timeUntilHit = obj.time - currentTime;
    const progress = 1 - (timeUntilHit / this.approachTime);
    
    if (progress < 0) return;

    const radius = 150 * this.scale;

    ctx.beginPath();
    ctx.arc(centerX.x, centerX.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 4 * this.scale;
    ctx.stroke();

    const angle = (currentTime / 300) % (Math.PI * 2);
    ctx.beginPath();
    ctx.arc(centerX.x, centerX.y, radius * 0.7, angle, angle + Math.PI * 1.5);
    ctx.strokeStyle = '#FF6B6B';
    ctx.lineWidth = 6 * this.scale;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX.x, centerX.y, radius * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 107, 107, 0.3)';
    ctx.fill();

    ctx.font = `bold ${Math.max(16, 24 * this.scale)}px sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPINNER', centerX.x, centerX.y);
  }

  private drawHitEffect(x: number, y: number, judgment: string, elapsed: number) {
    const ctx = this.ctx;
    const pos = this.playfieldToScreen(x, y);
    const alpha = Math.max(0, 1 - (elapsed / 500));
    const expand = 1 + elapsed / 150;

    const color = judgment === '300' ? '#66CCFF' : judgment === '100' ? '#88B300' : '#FFAA00';
    const radius = this.circleRadius * this.scale * expand;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
    ctx.lineWidth = Math.max(2, 4 * this.scale * alpha);
    ctx.stroke();

    if (elapsed < 100) {
      const flashAlpha = (1 - elapsed / 100) * 0.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, this.circleRadius * this.scale * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
      ctx.fill();
    }

    const textAlpha = Math.max(0, 1 - (elapsed / 400));
    const textY = pos.y - radius - 15 * this.scale;
    ctx.font = `bold ${Math.max(14, 20 * this.scale)}px sans-serif`;
    ctx.fillStyle = color + Math.floor(textAlpha * 255).toString(16).padStart(2, '0');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(judgment, pos.x, textY);
  }

  private drawMissEffect(x: number, y: number, elapsed: number) {
    const ctx = this.ctx;
    const pos = this.playfieldToScreen(x, y);
    const alpha = Math.max(0, 1 - (elapsed / 500));

    const size = 20 * this.scale;
    ctx.strokeStyle = `rgba(255, 50, 50, ${alpha})`;
    ctx.lineWidth = Math.max(2, 3 * this.scale);
    ctx.beginPath();
    ctx.moveTo(pos.x - size, pos.y - size);
    ctx.lineTo(pos.x + size, pos.y + size);
    ctx.moveTo(pos.x + size, pos.y - size);
    ctx.lineTo(pos.x - size, pos.y + size);
    ctx.stroke();

    ctx.font = `bold ${Math.max(14, 18 * this.scale)}px sans-serif`;
    ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MISS', pos.x, pos.y + 30 * this.scale);
  }

  private updateAndDrawParticles() {
    const ctx = this.ctx;
    
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.vy += 0.05;
      p.life -= 0.025;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      const pos = this.playfieldToScreen(p.x, p.y);
      const alpha = p.life / p.maxLife;
      const size = p.size * this.scale * alpha;
      
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.floor(alpha * 220).toString(16).padStart(2, '0');
      ctx.fill();
    }
  }

  private drawCursor() {
    const ctx = this.ctx;
    const pos = this.playfieldToScreen(this.cursorPos.x, this.cursorPos.y);
    const size = 12 * this.scale;

    const glowSize = this.cursorPressed ? size * 2.5 : size * 2;
    const glowColor = this.cursorPressed ? 'rgba(255, 100, 100,' : 'rgba(100, 200, 255,';
    const glowGrad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowSize);
    glowGrad.addColorStop(0, glowColor + '0.3)');
    glowGrad.addColorStop(1, glowColor + '0)');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, glowSize, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
    const cursorColor = this.cursorPressed ? '#FF6B6B' : '#FFFFFF';
    ctx.fillStyle = cursorColor;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
    ctx.strokeStyle = this.cursorPressed ? '#FF3333' : '#66CCFF';
    ctx.lineWidth = Math.max(2, 2.5 * this.scale);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, size * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = this.cursorPressed ? '#FFFFFF' : '#66CCFF';
    ctx.fill();
  }

  private drawCombo() {
    const ctx = this.ctx;
    const comboX = this.playfieldToScreen(256, 40);
    
    ctx.font = `bold ${Math.max(24, 42 * this.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(`${this.state.combo}x`, comboX.x + 2, comboX.y + 2);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(`${this.state.combo}x`, comboX.x, comboX.y);
  }

  private drawHitErrorBar() {
    const ctx = this.ctx;
    const barWidth = Math.min(300, this.canvas.width * 0.4);
    const barHeight = Math.max(4, 6 * this.scale);
    const barX = (this.canvas.width - barWidth) / 2;
    const barY = this.canvas.height - 25 * this.scale;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    const rx = barX - 4, ry = barY - 4, rw = barWidth + 8, rh = barHeight + 8, rr = 4;
    ctx.moveTo(rx + rr, ry);
    ctx.lineTo(rx + rw - rr, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
    ctx.lineTo(rx + rw, ry + rh - rr);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
    ctx.lineTo(rx + rr, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
    ctx.lineTo(rx, ry + rr);
    ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(50, 50, 50, 0.6)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    const recent = this.hitErrors.slice(-30);
    for (let i = 0; i < recent.length; i++) {
      const error = recent[i];
      const normalized = error / this.hitWindow50;
      const x = barX + barWidth / 2 + normalized * barWidth / 2;
      const age = (recent.length - i) / recent.length;
      
      const color = Math.abs(error) <= this.hitWindow300 ? '#66CCFF' : 
                     Math.abs(error) <= this.hitWindow100 ? '#88B300' : '#FFAA00';
      
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.3 + age * 0.7;
      ctx.fillRect(x - 1, barY, 2, barHeight);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(barX + barWidth / 2 - 1, barY - 3, 2, barHeight + 6);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.boundResize);
    this.canvas.removeEventListener('mousemove', this.boundMouseMove);
    this.canvas.removeEventListener('mousedown', this.boundMouseDown);
    this.canvas.removeEventListener('mouseup', this.boundMouseUp);
    this.canvas.removeEventListener('touchstart', this.boundTouchStart);
    this.canvas.removeEventListener('touchmove', this.boundTouchMove);
    this.canvas.removeEventListener('touchend', this.boundTouchEnd);
    document.removeEventListener('keydown', this.boundKeyDown);
    document.removeEventListener('keyup', this.boundKeyUp);
  }
}
