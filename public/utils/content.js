export function textFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => textFromContent(item)).join('');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (Array.isArray(content.output_text)) {
      return content.output_text.join('');
    }
    if (Array.isArray(content.content)) {
      return textFromContent(content.content);
    }
    if (content.delta) {
      return textFromContent(content.delta);
    }
  }
  return '';
}

export function extractDeltaText(event) {
  if (!event) return '';
  if (event.delta) {
    if (typeof event.delta.text === 'string') {
      return event.delta.text;
    }
    if (Array.isArray(event.delta.output_text)) {
      return event.delta.output_text.join('');
    }
    if (Array.isArray(event.delta.content) || typeof event.delta.content === 'object') {
      return textFromContent(event.delta.content);
    }
  }
  if (event.item && event.item.content) {
    return textFromContent(event.item.content);
  }
  return '';
}

export function extractCompletedText(event, fallback = '') {
  if (!event) return fallback;
  const { response } = event;
  if (response) {
    if (Array.isArray(response.output_text)) {
      return response.output_text.join('');
    }
    if (Array.isArray(response.output)) {
      return textFromContent(response.output);
    }
    if (Array.isArray(response.content)) {
      return textFromContent(response.content);
    }
  }
  return fallback;
}
