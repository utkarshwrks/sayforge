/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // SAYFORGE palette — deep slate canvas with a molten-amber accent.
        forge: {
          bg: '#0b0e14',
          panel: '#12161f',
          card: '#161b26',
          border: '#232a38',
          muted: '#8590a6',
          text: '#e6e9ef',
          accent: '#ff8a3d',
          accent2: '#ffb066',
          ok: '#3ddc97',
          warn: '#f5c451',
          fail: '#ff5c72',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,138,61,0.25), 0 8px 40px -12px rgba(255,138,61,0.35)',
      },
    },
  },
  plugins: [],
};
