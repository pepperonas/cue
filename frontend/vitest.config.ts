import { defineConfig } from 'vitest/config'
import { APP_VERSION, REPO_ROOT } from './app-version.mjs'

export default defineConfig({
  // ⚠️ Diese Datei erbt NICHTS von vite.config.ts. Beides muss daher hier
  // wiederholt werden, und beides kommt aus derselben Quelle wie dort:
  //   · `define`, sonst kennt kein Test die Version des Builds
  //   · `fs.allow`, sonst darf der Test CHANGELOG.md oberhalb von frontend/
  //     nicht lesen (dasselbe gilt für den Dev-Server)
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    fs: { allow: [REPO_ROOT] },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
