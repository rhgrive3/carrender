import { isAppStateShape } from './storage';

const STATE_KEY = 'studycommander_state_v1';
const BACKUP_KEY = 'studycommander_state_migration_backup';

/**
 * Reactの初期化前に、読み取れない端末保存データを退避する。
 * loadStateがnullを返した後に初期状態が自動保存されても、元データを復旧できるようにする。
 */
export function preserveUnreadableState(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): boolean {
  let raw: string | null;
  try {
    raw = storage.getItem(STATE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isAppStateShape(parsed)) return false;
  } catch {
    // JSONとして読めない場合も同じバックアップ経路へ流す。
  }

  try {
    storage.setItem(BACKUP_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
