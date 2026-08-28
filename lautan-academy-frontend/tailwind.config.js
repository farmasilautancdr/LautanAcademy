/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        // Brand palette from the actual logo mark (two hands forming a
        // heart — cool blue on one side, warm orange/red on the other).
        // Token names kept as-is so every existing bg-aqua/text-coral/etc.
        // class across the app repoints automatically — single-file edit.
        deepsea:  '#0E3A5C',   // headers, nav, deep emphasis (was deep teal, now deep blue)
        seafoam:  '#F1F6FA',   // page background (cool light blue-gray)
        aqua:     '#1E88C7',   // primary actions, progress rings, links (logo's blue)
        aqualight:'#D7ECF7',   // subtle fills, hover states
        coral:    '#E8622C',   // streaks, "resume", warm CTA accent — used sparingly (logo's orange/red)
        ink:      '#132433',   // primary text
        slate:    '#5B7180',   // secondary/muted text
        // Ocean-adjacent extension of the palette (not from the logo, but
        // tonally consistent with it) — gives stat cards/rings a second and
        // third accent hue so a row of them doesn't read as one repeated
        // aqua block. Used sparingly, same as coral.
        seagrass: '#2E9C6B',   // muted teal-green — completion/positive stats
        seagrasslight: '#DFF3E9',
        sand:     '#D99A3E',   // warm sandy amber — in-progress/hours stats
        sandlight:'#FBEEDA',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
        script: ['"Alex Brush"', 'cursive'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
}
