# Firebase Realtime Database 安全規則

`database.rules.json` 是這個 app 用的資料庫安全規則。這裡沒有登入機制（靠 6 碼房間代碼運作），所以規則的目標不是「要求登入」，而是**把讀寫範圍鎖在單一房間內、並限制欄位型別與大小**，避免：

- 陌生人讀取/列出資料庫裡所有房間
- 任意寫入把整個資料庫清空或塞入垃圾資料（拉高 Firebase 帳單）
- 直接竄改籌碼數字（型別/範圍檢查）

## 如何套用

1. 到 [Firebase Console](https://console.firebase.google.com/) → 選擇專案 `poker-chip-calculator`
2. 左側選單 **Realtime Database** → 上方分頁 **規則（Rules）**
3. 把整份 `database.rules.json` 的內容貼上、覆蓋原本的規則
4. 按 **發布（Publish）**

套用後幾分鐘內，Firebase 會重新掃描並清除信箱裡的安全性警告。

## 規則邏輯摘要

- 根目錄禁止讀寫，只有 `rooms/<6碼代碼>` 底下可以存取，且代碼必須符合 `generateCode()` 產生的格式（6 碼大寫英數字）
- 讀取只能指定確切的房間代碼，無法列出整個 `rooms` 節點 → 防止掃描/爬取所有房間
- `players/*` 的 `chips`、`name`、`avatar` 等欄位有型別與長度上限檢查，防止塞入異常資料把畫面弄壞或炸費用
- `chat`、`reactions` 訊息長度有上限，防止洗版式灌爆資料庫
- `hand`、`history`、`stats` 欄位結構較複雜且會持續擴充新欄位，沿用 `$code` 層級的讀寫權限、不額外加嚴格 schema，避免日後加新功能時被規則擋掉

## 之後想更嚴格怎麼辦

如果之後想加正式帳號系統，可以在 `.write` 條件裡加上 `auth != null`，並改用 Firebase Authentication（Email/匿名登入皆可）。目前 app 沒有登入 UI，先不加這層，避免破壞現有的房間代碼流程。
