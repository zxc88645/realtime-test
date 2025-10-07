# WebRTC vs WebSocket Latency Lab

This project spins up a small Node.js server that exposes both a WebSocket echo
endpoint and a WebRTC data-channel peer. The included web UI negotiates both
transports, sends timestamped `ping` payloads every second, and compares the
round-trip latency so you can see how each protocol performs in your
environment.

## Prerequisites

- Node.js 18 or newer (required for the `wrtc` native bindings)
- npm

## Getting started

```bash
npm install
npm start
```

Once the server is running, open `http://localhost:3000` in a modern browser and
press **Start test**. The dashboard will show live latency metrics for both
transports.

## How it works

- `server.js` serves the static assets in `public/`, terminates WebSocket
  connections at `/openai/agents/realtime/ws`, and negotiates WebRTC answers via
  a REST endpoint at `/openai/agents/realtime/webrtc-offer` using the
  [`wrtc`](https://github.com/node-webrtc/node-webrtc) library.
- `public/app.js` opens both transports, schedules a timestamped JSON payload
  every second, and computes the round-trip latency when the echo arrives back.
- `public/styles.css` and `public/index.html` provide a simple dashboard so you
  can compare the numbers at a glance.

Because both transports run against the same server-side echo logic, the
comparison focuses on the underlying protocol behavior (connection time, jitter,
round-trip time) instead of app-specific processing.

## Where to put your OpenAI API key

The demo server is self-contained and does not make outbound calls to OpenAI,
so you do not need an API key to run the latency lab locally. If you adapt this
project to call OpenAI services, add your credentials to a `.env` file (or set
them in the shell) using the standard `OPENAI_API_KEY` environment variable:

```bash
cp .env.example .env
echo "OPENAI_API_KEY=sk-your-key" >> .env
```

The `.env` file is already ignored by Git, so your key will remain local to your
machine. You can keep `.env.example` committed to share the required variable
names with collaborators without leaking secrets.
