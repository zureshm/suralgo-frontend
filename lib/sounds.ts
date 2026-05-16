export type SoundType = "enter" | "exit" | "profit" | "loss";

const audioCache: Partial<Record<SoundType, HTMLAudioElement>> = {};

function getAudio(type: SoundType): HTMLAudioElement {
  if (!audioCache[type]) {
    audioCache[type] = new Audio(`/${type}.mp3`);
  }
  return audioCache[type]!;
}

export function playSound(type: SoundType) {
  if (typeof window === "undefined") return;
  try {
    const audio = getAudio(type);
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
