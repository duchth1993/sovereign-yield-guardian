import { useId } from "react";

function buildWavePath(
  width: number,
  segments: number,
  baseline: number,
  amplitude: number,
  cycles: number,
) {
  let d = `M0,${baseline.toFixed(1)}`;
  for (let i = 1; i <= segments; i++) {
    const x = ((width * i) / segments).toFixed(1);
    const y = (baseline - amplitude * Math.sin((2 * Math.PI * cycles * i) / segments)).toFixed(1);
    d += ` L${x},${y}`;
  }
  d += ` L${width.toFixed(1)},320 L0,320 Z`;
  return d;
}

function Wave({
  baseline,
  amplitude,
  duration,
  opacity,
  reverse = false,
  height = "28%",
}: {
  baseline: number;
  amplitude: number;
  duration: number;
  opacity: number;
  reverse?: boolean;
  height?: string;
}) {
  const id = useId().replace(/:/g, "");
  const width = 2880;
  const viewHeight = 320;
  const d = buildWavePath(width, 120, baseline, amplitude, 2);

  return (
    <div
      className={`wave-layer ${reverse ? "wave-layer-reverse" : ""}`}
      style={{
        animationDuration: `${duration}s`,
        opacity,
        height,
      }}
      aria-hidden="true"
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${width} ${viewHeight}`}
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={`wave-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--wave-glow)" stopOpacity="0.25" />
            <stop offset="50%" stopColor="var(--wave-glow)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--wave-glow)" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        <path fill={`url(#wave-${id})`} d={d} />
      </svg>
    </div>
  );
}

export function AnimatedBackground() {
  return (
    <div className="animated-bg" aria-hidden="true">
      <div className="aurora-orb" />
      <div className="vignette" />
      <Wave baseline={170} amplitude={75} duration={32} opacity={0.14} height="28%" />
      <Wave baseline={210} amplitude={55} duration={24} opacity={0.1} reverse height="24%" />
      <Wave baseline={140} amplitude={90} duration={40} opacity={0.18} height="32%" />
    </div>
  );
}
