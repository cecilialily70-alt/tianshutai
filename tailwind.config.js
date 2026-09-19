/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        shell: {
          bg: '#111b21',
          card: '#202c33',
          hover: '#2a3942',
          line: '#2a3942',
          muted: '#8696a0',
          text: '#e9edef',
          accent: '#005c4b',
          wa: '#25D366',
        },
      },
      transitionTimingFunction: {
        shell: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
