import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface CircleButtonProps {
  onClick: () => void;
  clickCount?: number;
}

export default function CircleButton({ onClick, clickCount = 0 }: CircleButtonProps) {
  return (
    <motion.div
      className="flex justify-center"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.96 }}
    >
      {/* Neon gradient ring wrapper for glowing edges */}
      <div
        className="
          relative p-[2px] rounded-full
          bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-indigo-400
          transition-all duration-300
          hover:from-indigo-400 hover:via-cyan-400 hover:to-fuchsia-500
          shadow-[0_0_18px_rgba(34,211,238,0.55),0_0_36px_rgba(124,58,237,0.45)]
          hover:shadow-[0_0_26px_rgba(34,211,238,0.75),0_0_52px_rgba(124,58,237,0.6)]
        "
      >
        <Button
          onClick={onClick}
          aria-label="One Click One World"
          className="
            group w-32 h-32 rounded-full
            bg-[rgba(8,12,22,0.92)] hover:bg-[rgba(8,12,22,0.85)]
            border border-white/10
            inline-flex items-center justify-center text-center
            transition-all duration-300 ease-out
            backdrop-blur-sm
            shadow-[0_6px_28px_rgba(15,23,42,0.65)]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-0
          "
          size="lg"
        >
          <motion.div
            className="
              text-white font-extrabold text-center leading-tight px-2
              drop-shadow-[0_0_10px_rgba(34,211,238,0.35)]
            "
            animate={{
              scale: clickCount > 0 ? [1, 1.15, 1] : 1,
            }}
            transition={{
              duration: 0.28,
              ease: 'easeInOut',
            }}
          >
            <span className="block text-sm sm:text-base">One Click</span>
            <span className="block text-sm sm:text-base">One World</span>
          </motion.div>

          {/* Soft outer glow on hover */}
          <span
            className="
              pointer-events-none absolute inset-0 rounded-full
              transition-opacity duration-300
              opacity-0 group-hover:opacity-100
              bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.18),rgba(124,58,237,0.12)_60%,transparent_70%)]
              blur-[2px]
            "
          />
        </Button>
      </div>
    </motion.div>
  );
}