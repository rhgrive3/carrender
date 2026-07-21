export const APP_COMMAND_MESSAGE_EVENT = 'studycommander:app-command-message';

export type AppCommandMessageTone = 'info' | 'success' | 'warning' | 'error';

export interface AppCommandMessageDetail {
  message: string;
  tone: AppCommandMessageTone;
}

export function emitAppCommandMessage(message: string, tone: AppCommandMessageTone = 'info'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppCommandMessageDetail>(APP_COMMAND_MESSAGE_EVENT, {
    detail: { message, tone },
  }));
}
