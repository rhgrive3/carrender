import { useEffect, useState } from 'react';

const COLORS = ['#4f7cff', '#9a5cff', '#2ecc8f', '#ffb648', '#ff5d73', '#00a8cc'];

/** タスク完了時の軽い紙吹雪演出 */
export function Confetti({ trigger }: { trigger: number }) {
  const [pieces, setPieces] = useState<{ id: number; left: number; delay: number; color: string; rot: number }[]>([]);

  useEffect(() => {
    if (trigger === 0) return;
    const items = Array.from({ length: 26 }, (_, i) => ({
      id: trigger * 100 + i,
      left: Math.random() * 100,
      delay: Math.random() * 0.35,
      color: COLORS[i % COLORS.length],
      rot: Math.random() * 360,
    }));
    setPieces(items);
    const t = setTimeout(() => setPieces([]), 2000);
    return () => clearTimeout(t);
  }, [trigger]);

  if (pieces.length === 0) return null;

  return (
    <div className="celebrate" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}
