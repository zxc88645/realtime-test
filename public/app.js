import {
  createApp,
  computed,
  reactive,
  ref,
  watch,
} from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
import {
  LANGUAGE_OPTIONS,
  LANGUAGE_STORAGE_KEY,
  MODE_LABELS,
  MODE_OPTIONS,
  THEME_STORAGE_KEY,
} from './constants.js';
import { messageBubbleClass, messageContainerClass, roleLabel } from './ui/messages.js';
import { createTransportContext, appendMessage } from './transports/context.js';
import {
  startWebSocketTransport,
  stopWebSocketTransport,
} from './transports/websocket.js';
import { startWebRTCTransport, stopWebRTCTransport } from './transports/webrtc.js';

const app = createApp({
  setup() {
    const message = ref('');
    const messageInputRef = ref(null);
    const hasAttemptedConnection = reactive({ ws: false, webrtc: false });
    const selectedMode = ref('ws');
    const languageOptions = LANGUAGE_OPTIONS;

    const languageMap = new Map(languageOptions.map((item) => [item.id, item]));
    const getStoredLanguage = () => {
      try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored && languageMap.has(stored)) {
          return stored;
        }
      } catch (error) {
        console.warn('讀取偏好語言時發生錯誤', error);
      }
      return languageOptions[0]?.id ?? 'zh-Hant';
    };
    const selectedLanguageId = ref(getStoredLanguage());
    const activeLanguage = computed(
      () => languageMap.get(selectedLanguageId.value) ?? languageOptions[0]
    );

    watch(
      selectedLanguageId,
      (value) => {
        try {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
        } catch (error) {
          console.warn('儲存偏好語言時發生錯誤', error);
        }
        const language = languageMap.get(value) ?? languageOptions[0];
        if (
          ws.configureSession &&
          ws.connection &&
          ws.connection.readyState === WebSocket.OPEN
        ) {
          try {
            ws.configureSession(language);
          } catch (error) {
            console.warn('更新語音會話設定時發生錯誤', error);
          }
        }
      },
      { flush: 'post' }
    );

    const getPreferredTheme = () => {
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') {
          return stored;
        }
      } catch (error) {
        console.warn('讀取主題偏好失敗', error);
      }
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    };

    const theme = ref(getPreferredTheme());
    const isDarkTheme = computed(() => theme.value === 'dark');
    const themeToggleLabel = computed(() =>
      isDarkTheme.value ? '切換至亮色模式' : '切換至深色模式'
    );

    const applyTheme = (value) => {
      const themeValue = value === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', themeValue);
      document.body?.setAttribute('data-theme', themeValue);
    };

    watch(
      theme,
      (value) => {
        applyTheme(value);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, value);
        } catch (error) {
          console.warn('儲存主題偏好失敗', error);
        }
      },
      { immediate: true }
    );

    try {
      const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
      const handleChange = (event) => {
        const stored = (() => {
          try {
            return localStorage.getItem(THEME_STORAGE_KEY);
          } catch (error) {
            console.warn('讀取主題偏好失敗', error);
            return null;
          }
        })();
        if (!stored) {
          theme.value = event.matches ? 'dark' : 'light';
        }
      };
      if (mediaQuery?.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
      } else if (mediaQuery?.addListener) {
        mediaQuery.addListener(handleChange);
      }
    } catch (error) {
      console.warn('監聽系統主題偏好失敗', error);
    }

    const toggleTheme = () => {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
    };

    const ws = createTransportContext('ws');
    const webrtc = createTransportContext('webrtc');

    const activeTransport = computed(() => (selectedMode.value === 'ws' ? ws : webrtc));

    const activeModeLabel = computed(() => MODE_LABELS[selectedMode.value]);

    const activeModeDescription = computed(() => {
      const option = MODE_OPTIONS.find((item) => item.id === selectedMode.value);
      return option?.description ?? '';
    });

    const isConnecting = computed(() => {
      const transport = activeTransport.value;
      return !!transport.connection && !transport.isReady;
    });

    const startLabel = computed(() => {
      const transport = activeTransport.value;
      if (transport.isReady) {
        return '已連線';
      }
      if (isConnecting.value) {
        return '連線中…';
      }
      return hasAttemptedConnection[selectedMode.value] ? '重新連線' : '連線';
    });

    const startDisabled = computed(
      () => activeTransport.value.isReady || isConnecting.value
    );

    const canSend = computed(() => activeTransport.value.isReady);

    const onStartClick = () => {
      hasAttemptedConnection[selectedMode.value] = true;
      if (selectedMode.value === 'ws') {
        stopWebRTCTransport(webrtc);
        startWebSocketTransport(ws, () => activeLanguage.value);
      } else {
        stopWebSocketTransport(ws);
        startWebRTCTransport(webrtc, () => activeLanguage.value);
      }
    };

    const sendMessage = () => {
      const text = message.value.trim();
      if (!text) {
        return;
      }

      const transport = activeTransport.value;
      const sent = transport.send ? transport.send(text) : false;

      if (!sent) {
        const errorText = '無法傳送訊息，請確認所選模式已連線。';
        appendMessage(transport, 'error', errorText);
        return;
      }

      message.value = '';
      if (messageInputRef.value) {
        messageInputRef.value.focus();
      }
    };

    const startVoiceRecording = async () => {
      if (selectedMode.value !== 'ws') {
        return;
      }
      if (typeof ws.startRecording !== 'function') {
        appendMessage(ws, 'error', '請先建立 WebSocket 連線再開始錄音。');
        return;
      }
      try {
        await ws.startRecording();
      } catch (error) {
        console.error('啟動語音錄製時發生錯誤', error);
        appendMessage(ws, 'error', '啟動語音錄製時發生錯誤，請稍後再試。');
      }
    };

    const stopVoiceRecording = async () => {
      if (selectedMode.value !== 'ws') {
        return;
      }
      if (typeof ws.stopRecording === 'function') {
        try {
          await ws.stopRecording();
        } catch (error) {
          console.error('停止語音錄製時發生錯誤', error);
          appendMessage(ws, 'error', '停止錄音時發生錯誤，請重新連線。');
        }
      }
    };

    const playRecordedAudio = () => {
      if (!ws.recordedAudioUrl) {
        return;
      }
      const audio = new Audio(ws.recordedAudioUrl);
      audio.play().catch((error) => {
        console.error('播放錄音失敗', error);
      });
    };

    watch(selectedMode, (next, previous) => {
      if (previous === next) {
        return;
      }
      if (previous === 'ws') {
        stopWebSocketTransport(ws);
      } else {
        stopWebRTCTransport(webrtc);
      }
      message.value = '';
    });

    return {
      message,
      messageInputRef,
      ws,
      webrtc,
      activeTransport,
      activeModeLabel,
      activeModeDescription,
      selectedMode,
      modeOptions: MODE_OPTIONS,
      MODE_LABELS,
      startLabel,
      startDisabled,
      canSend,
      onStartClick,
      sendMessage,
      startVoiceRecording,
      stopVoiceRecording,
      playRecordedAudio,
      roleLabel,
      messageContainerClass,
      messageBubbleClass,
      languageOptions,
      selectedLanguageId,
      activeLanguage,
      theme,
      isDarkTheme,
      toggleTheme,
      themeToggleLabel,
    };
  },
});

app.mount('#app');
