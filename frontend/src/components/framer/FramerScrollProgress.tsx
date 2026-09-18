import React, { useState, useEffect } from 'react';
import { motion, useScroll, useSpring } from 'motion/react';
import { ArrowUp } from 'lucide-react';

export const FramerScrollProgress: React.FC = () => {
  const { scrollYProgress, scrollY } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 24,
    restDelta: 0.001
  });

  const [isVisible, setIsVisible] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(0);

  useEffect(() => {
    return scrollY.on('change', (latest) => {
      setIsVisible(latest > 350);
    });
  }, [scrollY]);

  useEffect(() => {
    return scrollYProgress.on('change', (latest) => {
      setScrollPercent(Math.round(latest * 100));
    });
  }, [scrollYProgress]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {/* Top Fixed Scroll Progress Glow Line */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 sm:h-1.25 bg-zinc-900/20 pointer-events-none">
        <motion.div
          className="h-full bg-gradient-to-r from-[#15803D] via-[#22C55E] to-[#CCFF00] origin-left relative"
          style={{ scaleX }}
        >
          {/* Luminous Leading Neon Sparkle */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#CCFF00] shadow-[0_0_10px_#CCFF00,0_0_20px_#22C55E] pointer-events-none" />
        </motion.div>
      </div>

      {/* Floating Scroll Percentage Indicator & Quick Return to Top */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={isVisible ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 20 }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        className="fixed bottom-22 sm:bottom-24 right-4 sm:right-6 z-40 flex items-center gap-1.5"
      >
        <button
          type="button"
          onClick={scrollToTop}
          className="group flex items-center gap-1.5 px-3 py-2 rounded-full bg-zinc-950/85 hover:bg-zinc-900 text-white backdrop-blur-md border border-white/20 shadow-xl shadow-emerald-950/20 text-xs font-sport font-extrabold uppercase tracking-wider cursor-pointer transition-all hover:scale-105 active:scale-95"
          title="Return to top"
        >
          <div className="relative w-4 h-4 flex items-center justify-center">
            <ArrowUp className="w-3.5 h-3.5 text-[#CCFF00] group-hover:-translate-y-0.5 transition-transform" />
          </div>
          <span className="text-[11px] font-mono text-[#CCFF00]">{scrollPercent}%</span>
        </button>
      </motion.div>
    </>
  );
};
