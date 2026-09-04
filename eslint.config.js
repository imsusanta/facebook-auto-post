module.exports = [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'uploads/**',
      'public/**',
      'dist/**',
      '.git/**',
      '.gemini/**'
    ]
  },
  {
    files: ['**/*.js'],
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
        URL: 'readonly'
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
  }
];
