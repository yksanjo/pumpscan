import type { CSSProperties } from "react";

type Pill = {
  top: string;
  left: string;
  size: number;
  duration: number;
  delay: number;
  tx: string;
  ty: string;
  r0: number;
  r1: number;
};

const PILLS: Pill[] = [
  { top: "8%",  left: "6%",  size: 72,  duration: 42, delay: 0,   tx: "70vw",  ty: "55vh",  r0: -18, r1: 200 },
  { top: "18%", left: "82%", size: 104, duration: 56, delay: -8,  tx: "-75vw", ty: "40vh",  r0: 22,  r1: -180 },
  { top: "36%", left: "12%", size: 56,  duration: 38, delay: -14, tx: "65vw",  ty: "-25vh", r0: -8,  r1: 240 },
  { top: "55%", left: "74%", size: 88,  duration: 50, delay: -22, tx: "-60vw", ty: "-45vh", r0: 12,  r1: -260 },
  { top: "70%", left: "4%",  size: 64,  duration: 46, delay: -3,  tx: "80vw",  ty: "-50vh", r0: -25, r1: 160 },
  { top: "82%", left: "88%", size: 80,  duration: 60, delay: -18, tx: "-70vw", ty: "-60vh", r0: 30,  r1: -220 },
  { top: "90%", left: "36%", size: 60,  duration: 40, delay: -10, tx: "35vw",  ty: "-75vh", r0: -14, r1: 180 },
  { top: "14%", left: "46%", size: 48,  duration: 36, delay: -25, tx: "-40vw", ty: "65vh",  r0: 18,  r1: -200 },
];

export default function FloatingPumpLogos() {
  return (
    <div aria-hidden className="floating-pump-logos">
      {PILLS.map((p, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src="/pump-logo.png"
          alt=""
          style={{
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            "--tx": p.tx,
            "--ty": p.ty,
            "--r0": `${p.r0}deg`,
            "--r1": `${p.r1}deg`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
