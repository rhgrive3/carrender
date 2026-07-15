export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastRequest {
  title: string;
  detail?: string;
  tone?: ToastTone;
  durationMs?: number;
  dedupeKey?: string;
  action?: ToastAction;
}

export type ToastInput = string | ToastRequest;

export interface ToastItem {
  id: string;
  title: string;
  detail: string | null;
  tone: ToastTone;
  durationMs: number;
  dedupeKey: string;
  action?: ToastAction;
}

export interface ToastQueueState {
  active: ToastItem | null;
  queued: ToastItem[];
}

export const EMPTY_TOAST_QUEUE: ToastQueueState = { active: null, queued: [] };
export const TOAST_TITLE_LIMIT = 62;
export const TOAST_QUEUE_LIMIT = 4;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateCharacters(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  return `${characters.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

function compactMessage(message: string): { title: string; detail: string | null } {
  const normalized = normalizeWhitespace(message) || '処理が完了しました';
  if (Array.from(normalized).length <= TOAST_TITLE_LIMIT) return { title: normalized, detail: null };

  const characters = Array.from(normalized);
  const preferredMinimum = 22;
  let boundary = -1;
  for (let index = preferredMinimum; index < Math.min(characters.length, TOAST_TITLE_LIMIT); index += 1) {
    if (/[。！？!?]/.test(characters[index])) {
      boundary = index + 1;
      break;
    }
  }
  const title = boundary > 0
    ? characters.slice(0, boundary).join('')
    : truncateCharacters(normalized, TOAST_TITLE_LIMIT);
  return { title, detail: normalized };
}

export function inferToastTone(message: string): ToastTone {
  if (/保存しましたが|一部|競合|未配置|判定未完了|確定でき|不足|確認が必要|許可されていません/.test(message)) return 'warning';
  if (/失敗|できません|不正|入力内容|以前にしてください|以降にしてください|未来日|エラー|読み込めません|開始できません/.test(message)) return 'error';
  if (/保存|更新|追加|削除|完了|戻|読み込み|統合|エクスポート|オンに|オフに/.test(message)) return 'success';
  return 'info';
}

export function toastDurationMs(tone: ToastTone, requested?: number, hasAction = false): number {
  if (requested !== undefined && Number.isFinite(requested)) {
    return Math.min(15_000, Math.max(2_000, Math.round(requested)));
  }
  const base = tone === 'error' ? 8_000 : tone === 'warning' ? 6_500 : tone === 'info' ? 4_200 : 3_200;
  return hasAction ? Math.max(base, 7_000) : base;
}

export function createToastItem(input: ToastInput, requestedTone: ToastTone | undefined, id: string): ToastItem {
  if (typeof input === 'string') {
    const compact = compactMessage(input);
    const tone = requestedTone ?? inferToastTone(input);
    return {
      id,
      title: compact.title,
      detail: compact.detail,
      tone,
      durationMs: toastDurationMs(tone),
      dedupeKey: `${tone}:${normalizeWhitespace(input)}`,
    };
  }

  const rawTitle = normalizeWhitespace(input.title) || 'お知らせ';
  const compact = compactMessage(rawTitle);
  const explicitDetail = input.detail ? normalizeWhitespace(input.detail) : null;
  const detail = explicitDetail ?? compact.detail;
  const tone = requestedTone ?? input.tone ?? inferToastTone(`${rawTitle} ${detail ?? ''}`);
  return {
    id,
    title: compact.title,
    detail,
    tone,
    durationMs: toastDurationMs(tone, input.durationMs, Boolean(input.action)),
    dedupeKey: input.dedupeKey ?? `${tone}:${rawTitle}:${detail ?? ''}`,
    ...(input.action ? { action: input.action } : {}),
  };
}

export function enqueueToast(state: ToastQueueState, item: ToastItem, limit = TOAST_QUEUE_LIMIT): ToastQueueState {
  const duplicate = [state.active, ...state.queued].some((candidate) => candidate?.dedupeKey === item.dedupeKey);
  if (duplicate) return state;
  if (!state.active) return { active: item, queued: state.queued };

  const queued = [...state.queued];
  if (queued.length >= limit) {
    const lowPriority = queued.findIndex((candidate) => candidate.tone === 'success' || candidate.tone === 'info');
    queued.splice(lowPriority >= 0 ? lowPriority : 0, 1);
  }
  queued.push(item);
  return { active: state.active, queued };
}

export function advanceToast(state: ToastQueueState): ToastQueueState {
  const [next, ...queued] = state.queued;
  return { active: next ?? null, queued };
}
