module.exports = [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'uploads/**',
      'dist/**',
      '.git/**',
      '.gemini/**'
    ]
  },
  // Server-side Node.js files
  {
    files: ['**/*.js'],
    ignores: ['public/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Set: 'readonly',
        Map: 'readonly',
        WeakSet: 'readonly',
        WeakMap: 'readonly',
        Promise: 'readonly',
        Date: 'readonly',
        RegExp: 'readonly',
        Error: 'readonly',
        JSON: 'readonly',
        Math: 'readonly',
        URL: 'readonly',
        Array: 'readonly',
        Object: 'readonly',
        String: 'readonly',
        Number: 'readonly',
        Boolean: 'readonly'
      }
    },
    rules: {
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error',
      'no-undef': 'error',
      'no-constant-condition': 'warn'
    }
  },
  // Browser-side JavaScript files
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        EventSource: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        FormData: 'readonly',
        FileReader: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        lucide: 'readonly',
        tailwind: 'readonly',
        JSON: 'readonly',
        Math: 'readonly',
        Date: 'readonly',
        Promise: 'readonly',
        Array: 'readonly',
        Object: 'readonly',
        String: 'readonly',
        Number: 'readonly',
        Boolean: 'readonly',
        Intl: 'readonly'
      }
    },
    rules: {
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error',
      'no-undef': 'error'
    }
  }
];
