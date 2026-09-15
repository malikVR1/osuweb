export interface TimingPoint {
  offset: number;
  msPerBeat: number;
  meter: number;
  sampleSet: number;
  sampleIndex: number;
  volume: number;
  uninherited: boolean;
  kiai: boolean;
}

export interface HitObject {
  x: number;
  y: number;
  time: number;
  type: number;
  hitSound: number;
  endTime?: number;
  curvePoints?: { x: number; y: number }[];
  slides?: number;
  length?: number;
  // Parsed
  isCircle: boolean;
  isSlider: boolean;
  isSpinner: boolean;
  comboNumber?: number;
}

export interface OsuMap {
  title: string;
  artist: string;
  creator: string;
  version: string;
  audioFilename: string;
  previewTime: number;
  // Difficulty
  circleSize: number;
  approachRate: number;
  overallDifficulty: number;
  hpDrain: number;
  sliderMultiplier: number;
  sliderTickRate: number;
  // Data
  timingPoints: TimingPoint[];
  hitObjects: HitObject[];
  // Background
  bgFilename: string;
  // Stack
  stackLeniency: number;
}

export interface GameState {
  score: number;
  combo: number;
  maxCombo: number;
  hits300: number;
  hits100: number;
  hits50: number;
  misses: number;
  accuracy: number;
  health: number;
}

export interface HitResult {
  time: number;
  judgment: '300' | '100' | '50' | 'miss' | 'slider-tick' | 'slider-end';
  x: number;
  y: number;
}
