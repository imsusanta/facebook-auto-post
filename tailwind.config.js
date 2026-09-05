module.exports = {
  content: ['./public/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA'
        }
      },
      fontFamily: { sans: ['system-ui', 'sans-serif'] }
    }
  },
  plugins: []
};
