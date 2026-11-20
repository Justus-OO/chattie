import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  preview: {
    allowedHosts: ['chattie-gx8z.onrender.com'],
  },
  define: {
    global: 'window',
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'livekit-components',
              test: /node_modules[\\/].*components-react/,
              minSize: 20_000,
              maxSize: 350_000,
              priority: 20,
              entriesAware: true,
            },
          ],
        },
      },
    },
  },
})