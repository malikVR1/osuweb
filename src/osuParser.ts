import { OsuMap, TimingPoint, HitObject } from './types';

export function parseOsuFile(content: string): OsuMap {
  const lines = content.split('\n').map(l => l.trim());
  
  const map: OsuMap = {
    title: 'Unknown',
    artist: 'Unknown',
    creator: 'Unknown',
    version: 'Normal',
    audioFilename: '',
    previewTime: 0,
    circleSize: 5,
    approachRate: 5,
    overallDifficulty: 5,
    hpDrain: 5,
    sliderMultiplier: 1.4,
    sliderTickRate: 1,
    timingPoints: [],
    hitObjects: [],
    bgFilename: '',
    stackLeniency: 0.7,
  };

  let currentSection = '';

  for (const line of lines) {
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1);
      continue;
    }
    if (line.startsWith('//') || line === '') continue;

    switch (currentSection) {
      case 'General':
        parseGeneral(line, map);
        break;
      case 'Metadata':
        parseMetadata(line, map);
        break;
      case 'Difficulty':
        parseDifficulty(line, map);
        break;
      case 'Events':
        parseEvents(line, map);
        break;
      case 'TimingPoints':
        parseTimingPoint(line, map);
        break;
      case 'HitObjects':
        parseHitObject(line, map);
        break;
    }
  }

  return map;
}

function parseGeneral(line: string, map: OsuMap) {
  const [key, value] = line.split(':').map(s => s.trim());
  switch (key) {
    case 'AudioFilename':
      map.audioFilename = value;
      break;
    case 'PreviewTime':
      map.previewTime = parseInt(value);
      break;
    case 'StackLeniency':
      map.stackLeniency = parseFloat(value);
      break;
  }
}

function parseMetadata(line: string, map: OsuMap) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return;
  const key = line.substring(0, colonIdx).trim();
  const value = line.substring(colonIdx + 1).trim();
  
  switch (key) {
    case 'Title':
      map.title = value;
      break;
    case 'Artist':
      map.artist = value;
      break;
    case 'Creator':
      map.creator = value;
      break;
    case 'Version':
      map.version = value;
      break;
  }
}

function parseDifficulty(line: string, map: OsuMap) {
  const [key, value] = line.split(':').map(s => s.trim());
  switch (key) {
    case 'CircleSize':
      map.circleSize = parseFloat(value);
      break;
    case 'OverallDifficulty':
      map.overallDifficulty = parseFloat(value);
      break;
    case 'ApproachRate':
      map.approachRate = parseFloat(value);
      break;
    case 'HPDrainRate':
      map.hpDrain = parseFloat(value);
      break;
    case 'SliderMultiplier':
      map.sliderMultiplier = parseFloat(value);
      break;
    case 'SliderTickRate':
      map.sliderTickRate = parseFloat(value);
      break;
  }
}

function parseEvents(line: string, map: OsuMap) {
  if (line.startsWith('0,') || line.startsWith('Background')) {
    const parts = line.split(',');
    if (parts.length >= 3) {
      map.bgFilename = parts[2].replace(/"/g, '');
    }
  }
}

function parseTimingPoint(line: string, map: OsuMap) {
  const parts = line.split(',');
  if (parts.length < 2) return;

  const tp: TimingPoint = {
    offset: parseFloat(parts[0]),
    msPerBeat: parseFloat(parts[1]),
    meter: parts.length > 2 ? parseInt(parts[2]) : 4,
    sampleSet: parts.length > 3 ? parseInt(parts[3]) : 0,
    sampleIndex: parts.length > 4 ? parseInt(parts[4]) : 0,
    volume: parts.length > 5 ? parseInt(parts[5]) : 100,
    uninherited: parts.length > 6 ? parts[6] === '1' : true,
    kiai: parts.length > 7 ? (parseInt(parts[7]) & 1) !== 0 : false,
  };

  map.timingPoints.push(tp);
}

function parseHitObject(line: string, map: OsuMap) {
  const parts = line.split(',');
  if (parts.length < 5) return;

  const x = parseInt(parts[0]);
  const y = parseInt(parts[1]);
  const time = parseInt(parts[2]);
  const type = parseInt(parts[3]);
  const hitSound = parseInt(parts[4]);

  const isCircle = (type & 1) !== 0;
  const isSlider = (type & 2) !== 0;
  const isSpinner = (type & 8) !== 0;

  const obj: HitObject = {
    x, y, time, type, hitSound,
    isCircle, isSlider, isSpinner,
  };

  if (isSlider && parts.length > 5) {
    const curveData = parts[5];
    const curveParts = curveData.split('|');
    // curveParts[0] is curve type (L, B, P, etc.)
    
    obj.curvePoints = [];
    for (let i = 1; i < curveParts.length; i++) {
      const coords = curveParts[i].split(':');
      if (coords.length >= 2) {
        const px = parseInt(coords[0]);
        const py = parseInt(coords[1]);
        // Only add valid points
        if (!isNaN(px) && !isNaN(py)) {
          obj.curvePoints.push({ x: px, y: py });
        }
      }
    }

    if (parts.length > 6) obj.slides = parseInt(parts[6]) || 1;
    if (parts.length > 7) obj.length = parseFloat(parts[7]);
    
    // Ensure slides has a default
    if (!obj.slides) obj.slides = 1;
    
    // Calculate end time for sliders
    if (obj.length && obj.length > 0 && obj.slides) {
      const beatLength = getBeatLengthAtTime(map, time);
      const sliderTime = (obj.length / (map.sliderMultiplier * 100)) * beatLength;
      obj.endTime = time + sliderTime * obj.slides;
    } else if (obj.curvePoints && obj.curvePoints.length > 0) {
      // Fallback: estimate slider time from curve points distance
      let totalDistance = 0;
      let prevX = obj.x;
      let prevY = obj.y;
      for (const point of obj.curvePoints) {
        const dx = point.x - prevX;
        const dy = point.y - prevY;
        totalDistance += Math.sqrt(dx * dx + dy * dy);
        prevX = point.x;
        prevY = point.y;
      }
      const beatLength = getBeatLengthAtTime(map, time);
      const sliderTime = (totalDistance / (map.sliderMultiplier * 100)) * beatLength;
      obj.endTime = time + sliderTime * (obj.slides || 1);
      obj.length = totalDistance;
    }
  }

  if (isSpinner && parts.length > 5) {
    obj.endTime = parseInt(parts[5]);
  }

  map.hitObjects.push(obj);
}

function getBeatLengthAtTime(map: OsuMap, time: number): number {
  let beatLength = 500; // default 120 BPM
  let lastOffset = -Infinity;
  
  for (const tp of map.timingPoints) {
    if (tp.offset <= time && tp.uninherited && tp.offset >= lastOffset) {
      beatLength = tp.msPerBeat;
      lastOffset = tp.offset;
    }
  }
  
  // Fallback: if no uninherited timing point found, use the first one
  if (lastOffset === -Infinity && map.timingPoints.length > 0) {
    for (const tp of map.timingPoints) {
      if (tp.uninherited && tp.msPerBeat > 0) {
        beatLength = tp.msPerBeat;
        break;
      }
    }
  }
  
  return beatLength;
}

export function getApproachTime(ar: number): number {
  if (ar < 5) return 1800 - 120 * ar;
  return 1200 - 150 * (ar - 5);
}

export function getCircleRadius(cs: number): number {
  return 54.4 - 4.48 * cs;
}

export function getHitWindow(od: number, judgment: '300' | '100' | '50'): number {
  switch (judgment) {
    case '300': return 80 - 6 * od;
    case '100': return 140 - 8 * od;
    case '50': return 200 - 10 * od;
  }
}
