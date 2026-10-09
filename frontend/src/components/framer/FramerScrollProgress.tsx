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

  useEffect(() => {
    let currentVisible = false;
    return scrollY.on('change', (latest) => {
      const nextVisible = latest > 350;
      if (nextVisible !== currentVisible) {
        currentVisible = nextVisible;
        setIsVisible(nextVisible);
      }
    });
  }, [scrollY]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {/* Top Fixed Scroll Progress Glow Line */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 sm:h-1.25 bg-zinc-900/20 pointer-events-none">
        <motion.div
          className="h-full bg-gradient-to-r from-[#15803D] via-[#22C55E] to-[#D2EE5E] origin-left relative"
          style={{ scaleX }}
        >
          {/* Luminous Leading Neon Sparkle */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[#D2EE5E] shadow-[0_0_10px_#D2EE5E,0_0_20px_#22C55E] pointer-events-none" />
        </motion.div>
      </div>

      {/* Back to top */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={isVisible ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.8, y: 20 }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        className={`fixed bottom-5 sm:bottom-6 right-4 sm:right-6 z-40 ${isVisible ? '' : 'pointer-events-none'}`}
      >
        <button
          type="button"
          onClick={scrollToTop}
          className="group flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950/85 hover:bg-zinc-900 text-white backdrop-blur-md border border-white/20 shadow-xl shadow-emerald-950/20 cursor-pointer transition-all hover:scale-105 active:scale-95"
          title="Back to top"
          aria-label="Back to top"
        >
          <ArrowUp className="w-4 h-4 text-[#D2EE5E] group-hover:-translate-y-0.5 transition-transform" />
        </button>
      </motion.div>
    </>
  );
};
