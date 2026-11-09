let context: AudioContext | null = null;

/** Two short rising notes, made here: no sound file to ship or load */
export function playChime(): void {
  try {
    context ??= new AudioContext();
    const start = context.currentTime;
    for (const [i, hz] of [660, 880].entries()) {
      const at = start + i * 0.16;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(gain).connect(context.destination);
      osc.start(at);
      osc.stop(at + 0.32);
    }
  } catch {
    /* no audio device: the notice still shows */
  }
}
