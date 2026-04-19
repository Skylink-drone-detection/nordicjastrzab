import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0', 
    proxy: {
      '/osm': {
        target: 'https://tile.openstreetmap.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/osm/, '')
      },
      '/elevation': {
        target: 'https://elevation-tiles-prod.s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/elevation/, '')
      },
      '/satellite': {
        target: 'https://server.arcgisonline.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/satellite/, '')
      }
    }
  },
  preview: { port: 3000 },
  plugins: [
    tsconfigPaths(),
    {
      name: 'serve-panel-data',
      configureServer(server) {
        const filePath = path.resolve(__dirname, 'panel_data.json');

        // Cache in memory — immune to Windows file locks
        let cachedData = '[]';
        let lastMtime = 0;

        function tryRead() {
          try {
            const stat = fs.statSync(filePath);
            // Only re-read if file actually changed
            if (stat.mtimeMs !== lastMtime) {
              cachedData = fs.readFileSync(filePath, 'utf-8');
              lastMtime = stat.mtimeMs;
            }
          } catch {
            // File locked by Python or doesn't exist yet — keep last good read
          }
        }

        // Poll every 500ms
        tryRead();
        const interval = setInterval(tryRead, 500);

        // Clean up on server close
        server.httpServer?.on('close', () => clearInterval(interval));

        // Serve cached version instantly, never touches disk during request
        server.middlewares.use((req, res, next) => {
          if (req.url === '/panel_data.json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(cachedData);
            return;
          }
          next();
        });
      }
    }
  ]
});
