import type { Config } from 'tailwindcss';
import path from 'path';

const config: Config = {
  content: [
    path.join(__dirname, 'src/**/*.{js,ts,jsx,tsx}'),
    path.join(__dirname, 'index.html'),
  ],
  theme: {
    extend: {
      colors: {
        racing: {
          50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5',
          400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c',
          800: '#991b1b', 900: '#7f1d1d', 950: '#450a0a',
        },
        carbon: {
          50: '#1a1a1a', 100: '#171717', 200: '#141414', 300: '#111111',
          400: '#0e0e0e', 500: '#0a0a0a', 600: '#080808', 700: '#050505',
          800: '#030303', 900: '#010101', 950: '#000000',
        },
      },
      fontFamily: {
        heading: ['Space Grotesk', 'sans-serif'],
        body: ['Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'needle-sweep': 'needleSweep 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'rev-up': 'revUp 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) both',
        'slide-right': 'slideRight 0.4s ease-out both',
        'float': 'float 3s ease-in-out infinite',
        'shimmer': 'shimmer 3s ease-in-out infinite',
      },
      keyframes: {
        needleSweep: { '0%': { transform: 'rotate(-135deg)' }, '100%': { transform: 'rotate(var(--needle-angle, 0deg))' } },
        glowPulse: { '0%, 100%': { boxShadow: '0 0 20px rgba(220,38,38,0.3)' }, '50%': { boxShadow: '0 0 50px rgba(220,38,38,0.6)' } },
        revUp: { '0%': { transform: 'scale(0.95)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        fadeUp: { from: { opacity: '0', transform: 'translateY(30px) scale(0.95)' }, to: { opacity: '1', transform: 'translateY(0) scale(1)' } },
        slideRight: { from: { opacity: '0', transform: 'translateX(-30px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
      },
    },
  },
  plugins: [],
};

export default config;
