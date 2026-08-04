/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        // Ocean-depth palette — "lautan" = ocean. Deep teal instead of default
        // SaaS indigo, coral instead of default green/blue "success" accents.
        deepsea:  '#0B3D3E',   // headers, nav, deep emphasis
        seafoam:  '#F3F7F6',   // page background
        aqua:     '#17A398',   // primary actions, progress rings, links
        aqualight:'#CFEAE6',   // subtle fills, hover states
        coral:    '#FF8552',   // streaks, "resume", warm CTA accent — used sparingly
        ink:      '#12262C',   // primary text
        slate:    '#5B7B7E',   // secondary/muted text
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
}
