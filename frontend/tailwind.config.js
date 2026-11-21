/** Couleurs pilotées par des variables CSS (voir src/index.css) : 2 skins × 2 modes. */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`
const names = ['bg', 'surface', 'surface2', 'line', 'ink', 'ink2', 'muted', 'accent', 'accent-strong', 'on-accent',
  'time', 'boardhead', 'boardhead-ink', 'board', 'board-alt', 'live', 'sim', 'danger', 'navactive', 'ring', 'tag', 'rain',
  'emergency', 'emergency-ink']

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: Object.fromEntries(names.map((n) => [n, v(n)])),
      fontFamily: {
        display: 'var(--font-display)',
        body: 'var(--font-body)',
        mono: 'var(--font-mono)',
      },
    },
  },
  plugins: [],
}
