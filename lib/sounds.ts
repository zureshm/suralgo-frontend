export type SoundType = "enter" | "exit" | "profit" | "loss";

const audioCache: Partial<Record<SoundType, HTMLAudioElement>> = {};

function getAudio(type: SoundType): HTMLAudioElement {
  if (!audioCache[type]) {
    const audio = new Audio(`/${type}.mp3`);
    audio.volume = defaultVolume;
    audioCache[type] = audio;
  }
  return audioCache[type]!;
}

let defaultVolume = 0.5;

function getVolume(): number {
  if (typeof window === "undefined") return defaultVolume;
  const stored = localStorage.getItem("soundVolume");
  return stored ? parseFloat(stored) : defaultVolume;
}

export function setVolume(volume: number) {
  if (typeof window === "undefined") return;
  defaultVolume = volume;
  localStorage.setItem("soundVolume", String(volume));
  // Update all cached audio elements
  Object.values(audioCache).forEach(audio => {
    audio.volume = volume;
  });
}

export function playSound(type: SoundType) {
  if (typeof window === "undefined") return;
  try {
    const audio = getAudio(type);
    audio.volume = getVolume();
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {
    // ignore audio errors
  }
}

export function playSoundEvents(events: SoundType[]) {
  if (!events.length) return;
  // Play all unique sounds in priority order with a delay between each
  // Priority: loss > profit > exit > enter
  const priority: SoundType[] = ["loss", "profit", "exit", "enter"];
  const unique = priority.filter((p) => events.includes(p));
  unique.forEach((type, i) => {
    setTimeout(() => playSound(type), i * 1500);
  });
}
