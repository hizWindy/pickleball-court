import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export const Toast: React.FC<{ message: string | null; onDone: () => void }> = ({ message, onDone }) => {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [message, onDone]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4" aria-live="polite">
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="pointer-events-auto max-w-md rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-medium text-white shadow-xl"
            onClick={onDone}
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
