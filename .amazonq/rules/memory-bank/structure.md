# 專案結構

## 目錄組織

### 根目錄層級

- `server.js` - 主要應用程式進入點
- `package.json` - Node.js 相依性與腳本
- `README.md` - 中文專案文件
- `AGENTS.md` - 代理程式特定文件
- `.env` / `.env.example` - 環境配置

### 原始碼 (`src/`)

**配置 (`src/config/`)**

- `constants.js` - 應用程式常數與環境變數
- `environment.js` - 環境驗證邏輯
- `loadEnvironment.js` - 環境載入工具

**HTTP 層 (`src/http/`)**

- `createExpressApp.js` - Express 應用程式工廠

**路由 (`src/routes/`)**

- `registerEphemeralTokenRoute.js` - WebRTC 金鑰端點處理器

**伺服器 (`src/server/`)**

- `realtimeServer.js` - 主要伺服器編排
- `createUpgradeHandler.js` - WebSocket 升級處理

**WebSocket (`src/websocket/`)**

- `createRealtimeWebSocketHandler.js` - WebSocket 代理實作

### 客戶端程式碼 (`public/`)

- `index.html` - 主要儀表板介面
- `app.js` - 客戶端傳輸比較邏輯
- `styles.css` - 儀表板樣式

### 測試 (`__tests__/`)

- `server.test.js` - 伺服器功能測試

## 核心元件

### 伺服器架構

1. **Express HTTP 伺服器** - 提供靜態檔案與 REST 端點
2. **WebSocket 代理** - 橋接客戶端 WebSocket 至 OpenAI Realtime API
3. **金鑰服務** - 生成短效 WebRTC 驗證金鑰
4. **升級處理器** - 管理 WebSocket 連線升級

### 客戶端架構

1. **傳輸管理器** - 處理雙重 WebSocket/WebRTC 連線
2. **延遲追蹤器** - 測量並比較回應時間
3. **儀表板 UI** - 測試與視覺化的互動介面
4. **事件協調器** - 跨傳輸同步相同請求

## 架構模式

- **工廠模式**：用於建立 Express 應用程式與處理器
- **代理模式**：WebSocket 流量轉發至 OpenAI
- **觀察者模式**：客戶端傳輸間的事件驅動通訊
- **配置模式**：集中化環境與常數管理
