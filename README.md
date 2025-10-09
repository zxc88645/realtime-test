# GPT 即時延遲實驗室

本專案會啟動一個 Node.js 伺服器，提供 WebSocket 橋接服務與簽發 WebRTC 短效金鑰的端點，方便你在瀏覽器中連線至 OpenAI 的 Realtime API。網頁介面會同時協商這兩種傳輸方式，將同樣的提示詞送往 GPT，並比較回傳所需的時間，讓你掌握在本地環境中的效能差異。

## 必要條件

- Node.js 18 或更新版本（提供原生 `fetch` 與相容於瀏覽器的 API）
- npm
- 具有 Realtime API 存取權的 OpenAI API 金鑰

## 快速開始

```bash
npm install
OPENAI_API_KEY=sk-your-key 
npm start
```

啟動伺服器後，使用現代瀏覽器開啟 `http://localhost:3000` 並按下 **連線**。待兩種傳輸管道就緒後，輸入訊息並按下 **送出**。儀表板會即時顯示 GPT 的回覆與往返延遲，協助你掌握差異。

## 運作方式

- `server.js` 會提供 `public/` 內的靜態資源、將 WebSocket 流量代理至 `wss://api.openai.com/v1/realtime`，並透過 `POST /v1/realtime/client_secrets` 簽發短效 WebRTC 金鑰。
- `public/app.js` 會同時開啟兩種傳輸，當你送出提示時發送相同的 `response.create` 事件，並記錄從送出到模型觸發 `response.completed` 的延遲。
- `public/styles.css` 與 `public/index.html` 提供儀表板，讓你並排比較雙方的對話與延遲。

因為兩種傳輸皆連向同一組 GPT 會話邏輯，差異主要反映在連線時間、抖動與往返表現，而非應用程式本身的處理流程。
