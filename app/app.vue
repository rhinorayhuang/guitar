<template>
  <div class="layout">
    <header class="site-header">
      <NuxtLink to="/" class="brand">🎸 吉他學習</NuxtLink>
      <nav>
        <NuxtLink to="/tuner">調音器</NuxtLink>
        <NuxtLink to="/chords">和弦</NuxtLink>
        <NuxtLink to="/practice">練習進度</NuxtLink>
      </nav>
    </header>
    <main class="content">
      <NuxtPage />
    </main>
  </div>
</template>

<style scoped>
.layout {
  max-width: 960px; margin: 0 auto; padding: 0 16px 48px;
  /* viewport-fit=cover 時避開橫向瀏海；不支援 env() 或值為 0 時與原本相同 */
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
}
.site-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border); }
.brand { font-weight: 700; color: var(--fg); text-decoration: none; }
nav { display: flex; flex-wrap: wrap; gap: 8px 16px; }
nav a { text-decoration: none; color: var(--fg-muted); }
nav a.router-link-active { color: var(--accent); }
.content { padding-top: 24px; }
</style>
