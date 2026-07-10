"use client";

import Image from "next/image";
import { PointerEvent, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

type LensKey = "anchor" | "timeline" | "observation";

const LENSES: Array<{
  id: LensKey;
  label: string;
  title: string;
  body: string;
  view: { scale: number; x: number; y: number };
}> = [
  {
    id: "anchor",
    label: "命盤基準",
    title: "日期是一級資料",
    body: "成立、掛牌與上市分開處理。時間不明，就不延伸到宮位。",
    view: { scale: 1.035, x: 0, y: 0 },
  },
  {
    id: "timeline",
    label: "價格軌跡",
    title: "把相位放回歷史",
    body: "藍線只記錄價格如何走過，不替下一步畫箭頭。",
    view: { scale: 1.12, x: -18, y: 24 },
  },
  {
    id: "observation",
    label: "觀測印記",
    title: "先記下，再回頭驗證",
    body: "未來窗口是一道觀察題，不是市場會照著走的答案。",
    view: { scale: 1.26, x: -42, y: -88 },
  },
];

export function HeroInstrument() {
  const rootRef = useRef<HTMLElement>(null);
  const [activeLens, setActiveLens] = useState<LensKey>("anchor");
  const reduceMotion = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, { stiffness: 150, damping: 28, mass: 0.35 });
  const smoothY = useSpring(pointerY, { stiffness: 150, damping: 28, mass: 0.35 });
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [2.4, -2.4]);
  const rotateY = useTransform(smoothX, [-0.5, 0.5], [-3.2, 3.2]);
  const imageX = useTransform(smoothX, [-0.5, 0.5], [-8, 8]);
  const imageY = useTransform(smoothY, [-0.5, 0.5], [-7, 7]);
  const sheenX = useTransform(smoothX, [-0.5, 0.5], [28, 72]);
  const sheenY = useTransform(smoothY, [-0.5, 0.5], [24, 68]);
  const sheen = useTransform(
    [sheenX, sheenY],
    ([x, y]) => `radial-gradient(circle at ${x}% ${y}%, rgba(244, 240, 230, 0.16), transparent 30%)`,
  );
  const { scrollYProgress } = useScroll({
    target: rootRef,
    offset: ["start end", "end start"],
  });
  const scrollShift = useTransform(scrollYProgress, [0, 1], [14, -14]);
  const active = LENSES.find((lens) => lens.id === activeLens) ?? LENSES[0];

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (reduceMotion || event.pointerType !== "mouse" || !hasFinePointer) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
    pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
  };

  const resetPointer = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  return (
    <motion.aside
      ref={rootRef}
      className="hero-orbit hero-instrument"
      aria-label="命盤基準、價格軌跡與觀測印記的互動主視覺"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      initial={reduceMotion ? false : { opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      style={reduceMotion ? undefined : { rotateX, rotateY, transformPerspective: 1200 }}
    >
      <motion.div
        className="hero-instrument-depth"
        style={reduceMotion ? undefined : { y: scrollShift }}
      >
        <motion.div
          className="hero-instrument-scene"
          data-active-lens={activeLens}
          animate={reduceMotion ? undefined : active.view}
          transition={{ type: "spring", stiffness: 90, damping: 24, mass: 0.7 }}
        >
          <motion.div
            className="hero-instrument-media"
            style={reduceMotion ? undefined : { x: imageX, y: imageY }}
          >
            <Image
              src="/images/panshi-celestial-market.webp"
              alt="黑鋼與黃銅天體儀交疊藍色歷史價格軌跡"
              fill
              priority
              sizes="(max-width: 920px) 100vw, (max-width: 1180px) 44vw, 560px"
            />
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.div
        className="hero-instrument-sheen"
        aria-hidden="true"
        style={reduceMotion ? undefined : { background: sheen }}
      />
      <div className="hero-instrument-scrim" aria-hidden="true" />

      <div className="hero-instrument-console">
        <div className="hero-instrument-tabs" role="group" aria-label="查看主視覺細節">
          {LENSES.map((lens) => (
            <motion.button
              key={lens.id}
              type="button"
              aria-pressed={activeLens === lens.id}
              onClick={() => setActiveLens(lens.id)}
              whileTap={reduceMotion ? undefined : { scale: 0.97 }}
            >
              {lens.label}
            </motion.button>
          ))}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="hero-orbit-note"
            key={active.id}
            initial={reduceMotion ? false : { opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            aria-live="polite"
          >
            <strong>{active.title}</strong>
            <p>{active.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
