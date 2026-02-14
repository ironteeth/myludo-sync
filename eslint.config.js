module.exports = [
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        Date: 'readonly',
        JSON: 'readonly',
        Object: 'readonly'
      }
    },
    rules: {
      // Bonnes pratiques
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'warn',
      'no-throw-literal': 'error',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-return-await': 'error',
      'require-await': 'warn',

      // Style de code
      'indent': ['error', 2, { SwitchCase: 1 }],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
      'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-blocks': 'error',
      'keyword-spacing': 'error',
      'space-infix-ops': 'error',
      'comma-spacing': ['error', { before: false, after: true }],
      'arrow-spacing': 'error',
      'no-multi-spaces': 'error',

      // Sécurité
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',

      // Async/Await
      'no-async-promise-executor': 'error',
      'no-promise-executor-return': 'error',

      // Fonctions
      'func-style': ['warn', 'declaration', { allowArrowFunctions: true }],
      'no-loop-func': 'error',
      'no-param-reassign': 'warn',

      // Objets et tableaux
      'no-prototype-builtins': 'error',
      'prefer-destructuring': ['warn', {
        object: true,
        array: false
      }]
    }
  },
  {
    ignores: [
      'node_modules/**',
      'cookies-http.json',
      '*.csv',
      '*.log',
      '.idea/**',
      '.git/**'
    ]
  }
];

