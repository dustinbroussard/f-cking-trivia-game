import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

function createContentSecurityPolicy(isDev: boolean) {
  const scriptSrc = ["'self'", 'https://apis.google.com'];
  const connectSrc = [
    "'self'",
    'https://*.supabase.co',
    'https://*.supabase.in',
    'wss://*.supabase.co',
    'wss://*.supabase.in',
    'https://*.googleapis.com',
    'https://*.googleusercontent.com',
    'https://www.googleapis.com',
  ];

  if (isDev) {
    scriptSrc.push("'unsafe-inline'", "'unsafe-eval'");
    connectSrc.push('ws:', 'http:');
  }

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com https://*.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' blob:",
    `connect-src ${connectSrc.join(' ')}`,
    "frame-src 'self' https://accounts.google.com https://apis.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  if (!isDev) {
    csp.push('upgrade-insecure-requests');
  }

  return csp.join('; ');
}

function createSecurityHeaders(isDev: boolean) {
  const headers: Record<string, string> = {
    'Content-Security-Policy': createContentSecurityPolicy(isDev),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };

  if (!isDev) {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  }

  return headers;
}

export default defineConfig(({ command }) => {
  const isDevServer = command === 'serve';
  const securityHeaders = createSecurityHeaders(isDevServer);
  const htmlInputs = {
    main: path.resolve(__dirname, 'index.html'),
  };

  return {
    envDir: '.',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: securityHeaders,
    },
    preview: {
      headers: createSecurityHeaders(false),
    },
    build: {
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        input: htmlInputs,
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            if (id.includes('motion') || id.includes('lucide-react') || id.includes('canvas-confetti')) {
              return 'ui-vendor';
            }
            if (id.includes('react')) return 'react-vendor';
          },
        },
      },
    },
  };
});
