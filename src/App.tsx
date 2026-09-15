import { useState, useRef, useCallback, useEffect } from 'react';
import { parseOsuFile } from './osuParser';
import { GameEngine } from './GameEngine';
import { OsuMap, GameState, HitResult } from './types';
import JSZip from 'jszip';

type Screen = 'menu' | 'song-select' | 'playing' | 'results';

interface SongInfo {
  title: string;
  artist: string;
  creator: string;
  version: string;
  map: OsuMap;
  audioBuffer: AudioBuffer | null;
  audioUrl: string | null;
  filename: string;
}

function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [selectedSong, setSelectedSong] = useState<number>(-1);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [finalResults, setFinalResults] = useState<{ state: GameState; results: HitResult[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const osuFileInputRef = useRef<HTMLInputElement>(null);
  const oszFileInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  };

  const decodeAudio = async (arrayBuffer: ArrayBuffer): Promise<AudioBuffer> => {
    const ctx = getAudioContext();
    return await ctx.decodeAudioData(arrayBuffer);
  };

  const handleOsuFileImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    setLoading(true);
    setLoadError(null);
    setLoadProgress('Parsing .osu files...');

    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.osu')) continue;

      try {
        const content = await file.text();
        const map = parseOsuFile(content);

        const songInfo: SongInfo = {
          title: map.title,
          artist: map.artist,
          creator: map.creator,
          version: map.version,
          map,
          audioBuffer: null,
          audioUrl: null,
          filename: file.name,
        };

        setSongs(prev => [...prev, songInfo]);
      } catch (err) {
        setLoadError(`Error parsing ${file.name}: ${err}`);
      }
    }

    setLoading(false);
    setLoadProgress('');
    if (osuFileInputRef.current) osuFileInputRef.current.value = '';
  }, []);

  const handleOszImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setLoadError(null);

    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.osz')) continue;

      try {
        setLoadProgress(`Extracting ${file.name}...`);
        const zip = await JSZip.loadAsync(file);
        
        // Find .osu files
        const osuFiles: { name: string; content: string }[] = [];
        const audioFiles: { name: string; data: ArrayBuffer }[] = [];

        for (const [filename, zipEntry] of Object.entries(zip.files)) {
          if (zipEntry.dir) continue;
          
          if (filename.endsWith('.osu')) {
            const content = await zipEntry.async('text');
            osuFiles.push({ name: filename, content });
          } else if (filename.endsWith('.mp3') || filename.endsWith('.ogg') || filename.endsWith('.wav')) {
            const data = await zipEntry.async('arraybuffer');
            audioFiles.push({ name: filename, data });
          }
        }

        // Decode audio files
        const audioBuffers: Map<string, AudioBuffer> = new Map();
        for (const audio of audioFiles) {
          try {
            setLoadProgress(`Decoding audio: ${audio.name}...`);
            const buffer = await decodeAudio(audio.data);
            audioBuffers.set(audio.name, buffer);
          } catch (e) {
            console.warn(`Failed to decode audio ${audio.name}:`, e);
          }
        }

        // Parse maps
        for (const osuFile of osuFiles) {
          try {
            const map = parseOsuFile(osuFile.content);
            const audioFilename = map.audioFilename;
            const audioBuffer = audioBuffers.get(audioFilename) || null;

            const songInfo: SongInfo = {
              title: map.title,
              artist: map.artist,
              creator: map.creator,
              version: map.version,
              map,
              audioBuffer,
              audioUrl: null,
              filename: osuFile.name,
            };

            setSongs(prev => [...prev, songInfo]);
          } catch (err) {
            console.error(`Error parsing ${osuFile.name}:`, err);
          }
        }
      } catch (err) {
        setLoadError(`Error processing ${file.name}: ${err}`);
      }
    }

    setLoading(false);
    setLoadProgress('');
    if (oszFileInputRef.current) oszFileInputRef.current.value = '';
  }, []);

  const handleLoadDemo = useCallback(async () => {
    setLoading(true);
    setLoadProgress('Generating demo map...');
    
    const demoContent = generateDemoMap();
    const map = parseOsuFile(demoContent);

    // Generate a simple audio beat using Web Audio API
    let audioBuffer: AudioBuffer | null = null;
    try {
      const ctx = getAudioContext();
      const sampleRate = ctx.sampleRate;
      const duration = 40; // seconds
      const length = sampleRate * duration;
      audioBuffer = ctx.createBuffer(2, length, sampleRate);
      
      const beatLength = 500; // ms
      const startTime = 2000; // ms
      
      for (let channel = 0; channel < 2; channel++) {
        const data = audioBuffer.getChannelData(channel);
        
        // Generate kick drum sounds at beat intervals
        for (let beat = 0; beat < 50; beat++) {
          const beatTime = (startTime + beat * beatLength) / 1000;
          const startSample = Math.floor(beatTime * sampleRate);
          const kickDuration = 0.1;
          const kickSamples = Math.floor(kickDuration * sampleRate);
          
          for (let i = 0; i < kickSamples && startSample + i < length; i++) {
            const t = i / sampleRate;
            const freq = 150 * Math.exp(-t * 30);
            const envelope = Math.exp(-t * 20);
            data[startSample + i] += Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
          }
        }

        // Add hi-hat on off-beats
        for (let beat = 0; beat < 100; beat++) {
          const beatTime = (startTime + beat * beatLength * 0.5) / 1000;
          const startSample = Math.floor(beatTime * sampleRate);
          const hatDuration = 0.03;
          const hatSamples = Math.floor(hatDuration * sampleRate);
          
          for (let i = 0; i < hatSamples && startSample + i < length; i++) {
            const t = i / sampleRate;
            const envelope = Math.exp(-t * 80);
            data[startSample + i] += (Math.random() * 2 - 1) * envelope * 0.15;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to generate demo audio:', e);
    }

    const songInfo: SongInfo = {
      title: map.title,
      artist: map.artist,
      creator: map.creator,
      version: map.version,
      map,
      audioBuffer,
      audioUrl: null,
      filename: 'demo.osu',
    };

    setSongs(prev => [...prev, songInfo]);
    setLoading(false);
    setLoadProgress('');
  }, []);

  const startGame = useCallback((index: number) => {
    setSelectedSong(index);
    setGameState({
      score: 0,
      combo: 0,
      maxCombo: 0,
      hits300: 0,
      hits100: 0,
      hits50: 0,
      misses: 0,
      accuracy: 100,
      health: 1,
    });
    setScreen('playing');
  }, []);

  useEffect(() => {
    if (screen === 'playing' && canvasRef.current && selectedSong >= 0) {
      const song = songs[selectedSong];
      if (!song) return;

      const engine = new GameEngine(
        canvasRef.current,
        song.map,
        song.audioBuffer,
        (state) => setGameState(state),
        (state, results) => {
          setFinalResults({ state, results });
          setScreen('results');
        }
      );

      engineRef.current = engine;
      
      setTimeout(() => engine.start(), 800);

      return () => {
        engine.destroy();
        engineRef.current = null;
      };
    }
  }, [screen, selectedSong, songs]);

  const handleQuit = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current.destroy();
    }
    setScreen('song-select');
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (screen === 'playing') {
          handleQuit();
        } else if (screen === 'results') {
          setScreen('song-select');
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [screen, handleQuit]);

  return (
    <div className="w-full h-screen bg-[#1a1a2e] text-white overflow-hidden flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#16213e] border-b border-[#0f3460] shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center font-bold text-sm">
            ω
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
            osu! Web
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {screen !== 'menu' && screen !== 'playing' && (
            <button
              onClick={() => setScreen('menu')}
              className="px-4 py-1.5 rounded-lg bg-[#0f3460] hover:bg-[#1a4a7a] transition-colors text-sm"
            >
              ← Menu
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {screen === 'menu' && (
          <MenuScreen
            onImportOsu={() => osuFileInputRef.current?.click()}
            onImportOsz={() => oszFileInputRef.current?.click()}
            onLoadDemo={handleLoadDemo}
            onSongSelect={() => setScreen('song-select')}
            songCount={songs.length}
            loading={loading}
            loadProgress={loadProgress}
            loadError={loadError}
          />
        )}
        {screen === 'song-select' && (
          <SongSelectScreen
            songs={songs}
            onSelect={startGame}
            onImportOsu={() => osuFileInputRef.current?.click()}
            onImportOsz={() => oszFileInputRef.current?.click()}
            onBack={() => setScreen('menu')}
          />
        )}
        {screen === 'playing' && (
          <PlayingScreen
            canvasRef={canvasRef}
            gameState={gameState}
            song={selectedSong >= 0 ? songs[selectedSong] : null}
            onQuit={handleQuit}
          />
        )}
        {screen === 'results' && finalResults && (
          <ResultsScreen
            state={finalResults.state}
            song={selectedSong >= 0 ? songs[selectedSong] : null}
            onRetry={() => selectedSong >= 0 && startGame(selectedSong)}
            onBack={() => setScreen('song-select')}
          />
        )}
      </main>

      {/* Hidden file inputs */}
      <input
        ref={osuFileInputRef}
        type="file"
        accept=".osu"
        multiple
        onChange={handleOsuFileImport}
        className="hidden"
      />
      <input
        ref={oszFileInputRef}
        type="file"
        accept=".osz"
        multiple
        onChange={handleOszImport}
        className="hidden"
      />
    </div>
  );
}

// Menu Screen
function MenuScreen({ onImportOsu, onImportOsz, onLoadDemo, onSongSelect, songCount, loading, loadProgress, loadError }: {
  onImportOsu: () => void;
  onImportOsz: () => void;
  onLoadDemo: () => void;
  onSongSelect: () => void;
  songCount: number;
  loading: boolean;
  loadProgress: string;
  loadError: string | null;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 p-8">
      {/* Logo */}
      <div className="text-center">
        <div className="w-28 h-28 mx-auto mb-4 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-5xl font-bold shadow-lg shadow-pink-500/30 animate-pulse-glow">
          ω
        </div>
        <h2 className="text-5xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
          osu! Web
        </h2>
        <p className="text-gray-400 mt-2">Browser-based rhythm game</p>
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-3 w-full max-w-sm">
        <button
          onClick={onSongSelect}
          disabled={songCount === 0}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 
            disabled:opacity-50 disabled:cursor-not-allowed transition-all font-bold text-lg shadow-lg shadow-pink-500/20 hover:scale-[1.02] active:scale-[0.98]"
        >
          🎵 Play {songCount > 0 && <span className="text-pink-200">({songCount} maps)</span>}
        </button>
        
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onImportOsz}
            disabled={loading}
            className="py-3 rounded-xl bg-[#0f3460] hover:bg-[#1a4a7a] transition-all font-semibold text-sm hover:scale-[1.02] active:scale-[0.98]"
          >
            📦 Import .osz
          </button>
          <button
            onClick={onImportOsu}
            disabled={loading}
            className="py-3 rounded-xl bg-[#0f3460] hover:bg-[#1a4a7a] transition-all font-semibold text-sm hover:scale-[1.02] active:scale-[0.98]"
          >
            📄 Import .osu
          </button>
        </div>
        
        <button
          onClick={onLoadDemo}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-[#0f3460] hover:bg-[#1a4a7a] transition-all font-semibold hover:scale-[1.02] active:scale-[0.98]"
        >
          🎮 Load Demo Map (with audio!)
        </button>
      </div>

      {loading && (
        <div className="text-center">
          <div className="text-yellow-400 animate-pulse mb-1">⏳ Loading...</div>
          {loadProgress && <div className="text-gray-400 text-sm">{loadProgress}</div>}
        </div>
      )}
      {loadError && (
        <div className="text-red-400 text-sm text-center max-w-md bg-red-900/20 p-3 rounded-lg">{loadError}</div>
      )}

      {/* Instructions */}
      <div className="mt-2 text-center text-gray-500 text-sm max-w-md space-y-1">
        <p>🎯 Click/tap circles in time with the music</p>
        <p>⌨️ Use <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300">Z</kbd> and <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300">X</kbd> keys or mouse/touch</p>
        <p>📦 .osz files include audio — .osu files need audio separately</p>
        <p>⎋ Press <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-300">Esc</kbd> to quit during gameplay</p>
      </div>
    </div>
  );
}

// Song Select Screen
function SongSelectScreen({ songs, onSelect, onImportOsu, onImportOsz, onBack }: {
  songs: SongInfo[];
  onSelect: (index: number) => void;
  onImportOsu: () => void;
  onImportOsz: () => void;
  onBack: () => void;
}) {
  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">🎵 Song Selection</h2>
        <div className="flex gap-2">
          <button
            onClick={onImportOsz}
            className="px-3 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 transition-colors text-sm"
          >
            📦 .osz
          </button>
          <button
            onClick={onImportOsu}
            className="px-3 py-2 rounded-lg bg-[#0f3460] hover:bg-[#1a4a7a] transition-colors text-sm"
          >
            📄 .osu
          </button>
          <button
            onClick={onBack}
            className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors text-sm"
          >
            ← Back
          </button>
        </div>
      </div>

      {songs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <p className="text-5xl mb-4 animate-float">🎵</p>
            <p className="text-lg">No maps imported yet</p>
            <p className="text-sm mt-2 text-gray-600">Import .osz files (with audio) or .osu files to get started!</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto grid gap-3 content-start pr-2">
          {songs.map((song, index) => (
            <div
              key={index}
              onClick={() => onSelect(index)}
              className="flex items-center gap-4 p-4 rounded-xl bg-[#16213e] border border-[#0f3460] 
                hover:border-pink-500/50 hover:bg-[#1a2a4e] cursor-pointer transition-all group"
            >
              <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-pink-500/30 to-purple-600/30 
                flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shrink-0">
                {song.audioBuffer ? '🎵' : '🎶'}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg truncate">
                  {song.artist} - {song.title}
                </h3>
                <p className="text-gray-400 text-sm truncate">
                  [{song.version}] mapped by {song.creator}
                </p>
                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                  <span>{song.map.hitObjects.length} objects</span>
                  <span>CS{song.map.circleSize.toFixed(1)}</span>
                  <span>AR{song.map.approachRate.toFixed(1)}</span>
                  <span>OD{song.map.overallDifficulty.toFixed(1)}</span>
                  {song.audioBuffer && <span className="text-green-400">✓ Audio</span>}
                </div>
              </div>
              <div className="text-pink-400 opacity-0 group-hover:opacity-100 transition-opacity text-2xl shrink-0">
                ▶
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Playing Screen
function PlayingScreen({ canvasRef, gameState, song, onQuit }: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  gameState: GameState | null;
  song: SongInfo | null;
  onQuit: () => void;
}) {
  return (
    <div className="h-full flex flex-col relative">
      {/* Game canvas */}
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ cursor: 'none' }}
        />
        
        {/* HUD overlay */}
        {gameState && (
          <div className="absolute top-4 right-4 text-right pointer-events-none">
            <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3 space-y-1 border border-white/10">
              <div className="text-2xl font-bold tabular-nums">
                {gameState.score.toLocaleString()}
              </div>
              <div className="text-sm text-gray-300">
                Acc: {gameState.accuracy.toFixed(2)}%
              </div>
              <div className="text-sm flex gap-2 justify-end">
                <span className="text-cyan-400">{gameState.hits300}</span>
                <span className="text-green-400">{gameState.hits100}</span>
                <span className="text-yellow-400">{gameState.hits50}</span>
                <span className="text-red-400">{gameState.misses}</span>
              </div>
            </div>
          </div>
        )}

        {/* Song info */}
        {song && (
          <div className="absolute top-4 left-4 pointer-events-none">
            <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3 border border-white/10">
              <div className="font-bold text-sm truncate max-w-[250px]">
                {song.artist} - {song.title}
              </div>
              <div className="text-gray-400 text-xs">
                [{song.version}]
              </div>
            </div>
          </div>
        )}

        {/* Quit button */}
        <button
          onClick={onQuit}
          className="absolute bottom-4 left-4 px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 
            transition-colors text-sm font-semibold backdrop-blur-sm border border-red-400/30"
        >
          ✕ Quit
        </button>

        {/* Controls hint */}
        <div className="absolute bottom-4 right-4 text-gray-500 text-xs pointer-events-none bg-black/40 px-3 py-1.5 rounded-lg">
          Click/Tap or Z/X to hit • Esc to quit
        </div>
      </div>
    </div>
  );
}

// Results Screen
function ResultsScreen({ state, song, onRetry, onBack }: {
  state: GameState;
  song: SongInfo | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const getGrade = () => {
    if (state.accuracy >= 100 && state.misses === 0) return { grade: 'SS', color: 'text-yellow-300', glow: 'shadow-yellow-500/50' };
    if (state.accuracy >= 95) return { grade: 'S', color: 'text-yellow-400', glow: 'shadow-yellow-500/30' };
    if (state.accuracy >= 90) return { grade: 'A', color: 'text-green-400', glow: 'shadow-green-500/30' };
    if (state.accuracy >= 80) return { grade: 'B', color: 'text-blue-400', glow: 'shadow-blue-500/30' };
    if (state.accuracy >= 70) return { grade: 'C', color: 'text-purple-400', glow: 'shadow-purple-500/30' };
    return { grade: 'D', color: 'text-red-400', glow: 'shadow-red-500/30' };
  };

  const { grade, color, glow } = getGrade();
  const totalHits = state.hits300 + state.hits100 + state.hits50 + state.misses;

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="bg-[#16213e] rounded-2xl p-8 max-w-lg w-full border border-[#0f3460] shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold mb-1">🏆 Results</h2>
          {song && (
            <p className="text-gray-400 truncate">
              {song.artist} - {song.title} [{song.version}]
            </p>
          )}
        </div>

        {/* Grade */}
        <div className="text-center mb-6">
          <div className={`text-9xl font-black ${color} drop-shadow-lg shadow-lg ${glow}`}>
            {grade}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-[#0f3460] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold tabular-nums">{state.score.toLocaleString()}</div>
            <div className="text-gray-400 text-xs mt-1">Score</div>
          </div>
          <div className="bg-[#0f3460] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{state.accuracy.toFixed(2)}%</div>
            <div className="text-gray-400 text-xs mt-1">Accuracy</div>
          </div>
          <div className="bg-[#0f3460] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{state.maxCombo}x</div>
            <div className="text-gray-400 text-xs mt-1">Max Combo</div>
          </div>
          <div className="bg-[#0f3460] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{totalHits}</div>
            <div className="text-gray-400 text-xs mt-1">Total Objects</div>
          </div>
        </div>

        {/* Hit distribution */}
        <div className="flex justify-center gap-8 mb-6 text-sm">
          <div className="text-center">
            <span className="text-cyan-400 font-bold text-2xl">{state.hits300}</span>
            <div className="text-gray-500 text-xs mt-1">300</div>
          </div>
          <div className="text-center">
            <span className="text-green-400 font-bold text-2xl">{state.hits100}</span>
            <div className="text-gray-500 text-xs mt-1">100</div>
          </div>
          <div className="text-center">
            <span className="text-yellow-400 font-bold text-2xl">{state.hits50}</span>
            <div className="text-gray-500 text-xs mt-1">50</div>
          </div>
          <div className="text-center">
            <span className="text-red-400 font-bold text-2xl">{state.misses}</span>
            <div className="text-gray-500 text-xs mt-1">Miss</div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onRetry}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 
              hover:from-pink-600 hover:to-purple-700 transition-all font-bold hover:scale-[1.02] active:scale-[0.98]"
          >
            🔄 Retry
          </button>
          <button
            onClick={onBack}
            className="flex-1 py-3 rounded-xl bg-[#0f3460] hover:bg-[#1a4a7a] transition-all font-bold hover:scale-[1.02] active:scale-[0.98]"
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}

// Generate a demo map with varied patterns
function generateDemoMap(): string {
  const hitObjects: string[] = [];
  const beatLength = 500; // 120 BPM
  const startTime = 2000;
  
  // Pattern 1: Simple circles going right
  for (let i = 0; i < 6; i++) {
    const x = 80 + i * 60;
    const y = 192;
    const time = startTime + i * beatLength;
    hitObjects.push(`${x},${y},${time},1,0`);
  }

  // Pattern 2: Slider (linear)
  const slider1Time = startTime + 7 * beatLength;
  hitObjects.push(`100,192,${slider1Time},2,0,L|200:150|300:200|400:192,1,250,0`);

  // Pattern 3: More circles
  for (let i = 0; i < 4; i++) {
    const x = 100 + i * 100;
    const y = i % 2 === 0 ? 100 : 280;
    const time = slider1Time + beatLength * 2 + i * beatLength;
    hitObjects.push(`${x},${y},${time},1,0`);
  }

  // Pattern 4: Another slider (bezier curve)
  const slider2Time = slider1Time + beatLength * 7;
  hitObjects.push(`256,80,${slider2Time},2,0,B|300:150|256:250|200:150,1,300,0`);

  // Pattern 5: Circles after slider
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6;
    const x = 256 + Math.cos(angle) * 120;
    const y = 192 + Math.sin(angle) * 100;
    const time = slider2Time + beatLength * 2 + i * (beatLength * 0.75);
    hitObjects.push(`${Math.round(x)},${Math.round(y)},${time},1,0`);
  }

  // Pattern 6: Slider zigzag
  const slider3Time = slider2Time + beatLength * 8;
  hitObjects.push(`80,300,${slider3Time},2,0,L|160:100|240:300|320:100|400:300,1,350,0`);

  // Pattern 7: Final circles
  for (let i = 0; i < 8; i++) {
    const x = 80 + (i % 4) * 110;
    const y = 80 + Math.floor(i / 4) * 200;
    const time = slider3Time + beatLength * 2 + i * (beatLength * 0.5);
    hitObjects.push(`${x},${y},${time},1,0`);
  }

  return `osu file format v14

[General]
AudioFilename: audio.mp3
PreviewTime: 0
Mode: 0

[Metadata]
Title:Demo Song
Artist:osu! Web
Creator:System
Version:Normal

[Difficulty]
CircleSize:4
OverallDifficulty:5
ApproachRate:7
HPDrainRate:5
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,${beatLength},4,1,0,100,1,0

[HitObjects]
${hitObjects.join('\n')}
`;
}

export default App;
