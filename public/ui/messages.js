import { MESSAGE_BASE_CLASS, ROLE_LABELS } from '../constants.js';

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

export function messageContainerClass(role) {
  if (role === 'user') {
    return 'flex flex-col items-end gap-2 text-right';
  }
  return 'flex flex-col items-start gap-2';
}

export function messageBubbleClass(role) {
  if (role === 'user') {
    return `${MESSAGE_BASE_CLASS} message-bubble--user`;
  }
  if (role === 'error') {
    return `${MESSAGE_BASE_CLASS} message-bubble--error`;
  }
  return `${MESSAGE_BASE_CLASS} message-bubble--assistant`;
}
