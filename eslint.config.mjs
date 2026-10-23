import coreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...coreWebVitals,
  { ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts', 'public/sw.js'] },
  {
    rules: {
      '@next/next/no-img-element': 'off',
      'react/no-unescaped-entities': 'off',
      // New in eslint-config-next 16 (react-hooks 6+). The app's fetch-on-mount / hydrate-from-localStorage effects are intentional; see DECISIONS.md.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
