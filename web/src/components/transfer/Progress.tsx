import { useEffect, useRef, useState } from 'react';

const IS_TEST = import.meta.env.MODE === 'test';

export function TransferProgressBar({
  percent,
  label = 'Transfer progress',
  animateFrom,
  durationMs,
  onReached,
}: {
  percent: number;
  label?: string;
  /** When set, animates from this value up to `percent`. */
  animateFrom?: number;
  durationMs?: number;
  onReached?: () => void;
}) {
  const target = Math.max(0, Math.min(100, Math.round(percent)));
  const start = Math.max(
    0,
    Math.min(target, Math.round(animateFrom ?? target)),
  );
  const duration = durationMs ?? (IS_TEST ? 0 : 2400);
  const [display, setDisplay] = useState(start);
  const reachedRef = useRef(false);
  const onReachedRef = useRef(onReached);
  onReachedRef.current = onReached;

  useEffect(() => {
    reachedRef.current = false;
    setDisplay(start);

    if (duration <= 0 || start >= target) {
      setDisplay(target);
      if (!reachedRef.current) {
        reachedRef.current = true;
        onReachedRef.current?.();
      }
      return;
    }

    let frame = 0;
    const begun = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - begun) / duration);
      // Ease-out so it feels like it settles at the gate.
      const eased = 1 - (1 - t) ** 2;
      const next = Math.round(start + (target - start) * eased);
      setDisplay(next);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else if (!reachedRef.current) {
        reachedRef.current = true;
        onReachedRef.current?.();
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [start, target, duration]);

  return (
    <div className="xfer-progress" aria-hidden={false}>
      <div className="xfer-progress-meta">
        <span>{label}</span>
      </div>
      <div
        className="xfer-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={display}
        aria-label={label}
      >
        <div className="xfer-progress-fill" style={{ width: `${display}%` }} />
      </div>
    </div>
  );
}
