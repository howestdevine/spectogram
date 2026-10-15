import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:lan` serves over HTTPS on the local network so a phone can
// open it (getUserMedia needs a secure context; plain localhost already is one).
export default defineConfig(({ mode }) => ({
  base: '/spectogram/',
  plugins: mode === 'lan' ? [basicSsl()] : [],
}));
