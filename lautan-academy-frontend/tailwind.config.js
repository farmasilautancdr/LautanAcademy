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
