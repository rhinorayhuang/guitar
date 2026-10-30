# 吉他學習 (guitar-learning)

Nuxt 4 + Vue 3 的吉他學習應用程式。

## 開發

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 和弦資料與練習進度驗證
```

## 資料

- `app/types/chord.ts`：和弦與練習階段的型別
- `app/data/chords.ts`：和弦指法（index 0 = 第 6 弦低音 E）
- `app/data/practice-plan.ts`：初學者練習進度
- `app/utils/validateChord.ts`：自動檢查音名、指法、封閉和弦、手指跨度

修改和弦或練習進度後，請呼叫 `guitar-teacher` agent 審查。

## 部署到 GitHub Pages

推到 `main` 時，`.github/workflows/deploy.yml` 會跑測試、用 `nuxt generate` 產生靜態網站並部署。
網址是 `https://<帳號>.github.io/<repo>/`，`NUXT_APP_BASE_URL` 會自動帶入 repo 名稱。

第一次使用前，到 repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。

本機預覽子路徑版本（Linux / macOS；Windows 的 Git Bash 會把 `/guitar-learning/` 轉成 Windows 路徑，要加 `MSYS_NO_PATHCONV=1`）：

```bash
NUXT_APP_BASE_URL=/guitar-learning/ npx nuxt generate
```

調音器需要麥克風，瀏覽器只在 HTTPS（或 localhost）開放；GitHub Pages 本身就是 HTTPS。

## 學習進度存在哪裡

沒有後端，過關紀錄只存在瀏覽器的 `localStorage`（key `guitar-learning:progress`），不會上傳。

- 每個網址是不同的網站：localhost、tunnel、GitHub Pages 的進度彼此看不到。
- 換手機、換瀏覽器或清除網站資料前，在練習頁底部「備份與搬移進度」匯出 JSON 備份檔；到新的地方匯入同一個檔案即可還原（與現有紀錄合併，不會覆蓋）。
- 第一次保存時會請瀏覽器把資料標為永久保存（`navigator.storage.persist()`），降低被自動清除的機會；iOS Safari 對未加到主畫面的網站仍可能清除，請定期匯出。
