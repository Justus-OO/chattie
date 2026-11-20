import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Add this define block to fix the sockjs-client error
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