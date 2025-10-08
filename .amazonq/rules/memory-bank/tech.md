# 技術堆疊

## 程式語言
- **JavaScript (Node.js)** - 伺服器端執行環境（需要 Node.js 18+）
- **JavaScript (瀏覽器)** - 客戶端應用程式邏輯
- **HTML5** - 儀表板介面結構
- **CSS3** - 儀表板樣式與版面配置

## 核心相依性
- **express** (^4.19.2) - Web 應用程式框架
- **ws** (^8.16.0) - Node.js 的 WebSocket 實作
- **wrtc** (^0.4.7) - Node.js 的 WebRTC 實作
- **dotenv** (^16.4.5) - 環境變數管理
- **node-pre-gyp** (^0.17.0) - 原生模組編譯支援

## 開發相依性
- **jest** (^29.7.0) - 測試框架
- **supertest** (^6.3.4) - 測試用 HTTP 斷言函式庫
- **prettier** (^3.2.5) - 程式碼格式化工具

## 建置系統
- **npm** - 套件管理與腳本執行
- **Node.js 原生模組** - 無需額外建置工具

## 開發指令
```bash
# 啟動應用程式
npm start

# 執行測試
npm test

# 格式化程式碼
npm run format

# 檢查格式化
npm run format:check

# 安裝相依性
npm install
```

## 執行環境需求
- **Node.js 18+** - 原生 fetch API 與瀏覽器相容功能所需
- **現代瀏覽器** - 需要 WebRTC 與 WebSocket 支援
- **OpenAI API 金鑰** - 必須具有 Realtime API 存取權限

## 環境配置
- `PORT` - 伺服器連接埠（預設：3000）
- `OPENAI_API_KEY` - 必需的 OpenAI API 金鑰
- `OPENAI_REALTIME_MODEL` - 模型選擇（預設：gpt-4o-realtime-preview-2024-12-17）
- `OPENAI_REALTIME_VOICE` - 聲音選擇（預設：verse）

## 外部 API
- **OpenAI Realtime API** - 主要 AI 服務端點
- **WebRTC STUN/TURN** - 瀏覽器原生 WebRTC 基礎設施