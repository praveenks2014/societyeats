import type { Config } from 'tailwindcss';

/**
 * PadosiPlate design tokens — "ghar ki rasoi, neighbourhood pride".
 * All colors derive from the five brand tokens; change them here to re-skin.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        rice: {
          DEFAULT: '#FBF7F0', // off-white rice canvas
          deep: '#F3EDE2',
          line: '#E7DFD0',
        },
        leaf: {
          DEFAULT: '#1E4D2B', // deep curry-leaf green (primary + veg trust)
          dark: '#143620',
          soft: '#2C6A3D',
          tint: '#E4EFE7',
        },
        turmeric: {
          DEFAULT: '#E8A020', // accent / CTA
          dark: '#C98712',
          deep: '#B97C10',
          tint: '#FBEED3',
        },
        chili: {
          DEFAULT: '#C63D2F', // non-veg marks + alerts
          dark: '#A32F23',
          tint: '#F9E4E1',
        },
        ink: {
          DEFAULT: '#22201C',
          soft: '#5C5648',
          faint: '#8B8272',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '1.1rem',
        pill: '999px',
      },
      boxShadow: {
        card: '0 2px 10px rgba(34, 32, 28, 0.07)',
        lift: '0 10px 30px rgba(34, 32, 28, 0.14)',
        bar: '0 -4px 18px rgba(34, 32, 28, 0.12)',
      },
      keyframes: {
        steam: {
          '0%': { transform: 'translateY(0) scaleX(1)', opacity: '0' },
          '25%': { opacity: '0.55' },
          '100%': { transform: 'translateY(-46px) scaleX(1.6)', opacity: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '80%': { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        steam: 'steam 3.2s ease-out infinite',
        shimmer: 'shimmer 1.4s infinite',
        'pop-in': 'pop-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
