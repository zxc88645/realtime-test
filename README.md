# GPT Realtime Latency Lab

This project spins up a small Node.js server that exposes a WebSocket bridge and
an endpoint for minting WebRTC ephemeral keys so you can connect to OpenAI's
Realtime API from the browser. The web UI negotiates both transports, sends your
prompt to GPT through each one, and compares the round-trip latency so you can
see how they perform in your environment.

## Prerequisites

- Node.js 18 or newer (required for native `fetch` and browser-compatible APIs)
- npm
- An OpenAI API key with access to the Realtime API

## Getting started

```bash
npm install
OPENAI_API_KEY=sk-your-key npm start
```

Once the server is running, open `http://localhost:3000` in a modern browser and
press **Connect**. After the connections are ready, type a message and press
**Send**. The dashboard will show GPT's replies for both transports and update
the latency metrics in real time.

## How it works

- `server.js` serves the static assets in `public/`, proxies WebSocket traffic
to `wss://api.openai.com/v1/realtime`, and exposes an endpoint that creates
short-lived WebRTC session tokens via `POST /v1/realtime/sessions`.
- `public/app.js` opens both transports, dispatches identical
  `response.create` events when you submit a prompt, and records the latency from
  send time to the model's `response.completed` event.
- `public/styles.css` and `public/index.html` provide a dashboard that lets you
  compare the two conversations and latency measurements side by side.

Because both transports route to the same GPT session logic, the comparison
highlights connection time, jitter, and round-trip performance differences
between the protocols instead of app-specific processing.
