import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root:fileURLToPath(new URL('./static-site',import.meta.url)),
  base:'/',
  publicDir:fileURLToPath(new URL('./public',import.meta.url)),
  resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
  plugins:[react()],
  server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':{target:'https://vexrank-api-test.vexrank-eason.workers.dev',changeOrigin:true}}},
  css:{postcss:{plugins:[tailwindcss()]}},
  define:{
    __VEX_API_BASE__:JSON.stringify(process.env.VEX_API_BASE || 'https://vexrank-api-test.vexrank-eason.workers.dev'),
    __VEX_ASSET_BASE__:JSON.stringify('/'),
  },
  build:{outDir:'../dist-pages',emptyOutDir:true},
});
