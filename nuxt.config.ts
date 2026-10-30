// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-28',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    // GitHub Pages 專案頁面在 /<repo>/ 底下：建置時以 NUXT_APP_BASE_URL 指定（見 .github/workflows/deploy.yml）
    head: {
      htmlAttrs: { lang: 'zh-Hant' },
      title: '吉他學習',
      // 讓 env(safe-area-inset-*) 有值（練習頁底部節拍器面板）；app.vue 的左右留白同時套用 safe area
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
    },
  },
  typescript: { strict: true },
})
