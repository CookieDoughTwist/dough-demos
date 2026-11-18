import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/dough-demos/',
  server: {
    // Its own port, so this never collides with another Vite app on the
    // default 5173. strictPort means a clash fails loudly instead of silently
    // moving to the next free port and leaving you on the wrong app.
    port: 5180,
    strictPort: true,
  },
})
