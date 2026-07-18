import type { AppState, ISODate } from '../types';
import { addDays, diffDays, formatMinutes } from './date';

/**
 * 今日の学習記録をSNS共有用のPNG画像(1080x1350)としてCanvasで生成する。
 * Web Share APIが使えれば共有シートを開き、なければダウンロードにフォールバックする。
 */

const W = 1080;
const H = 1350;
const SHARE_BUTTON_SELECTOR = 'button[aria-label="今日の記録をシェア画像にする"], button[aria-label="シェア画像を生成中"]';

type ShareStudyCardResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';
let shareInFlight: Promise<ShareStudyCardResult> | null = null;

function setShareButtonBusy(busy: boolean) {
  for (const button of document.querySelectorAll<HTMLButtonElement>(SHARE_BUTTON_SELECTOR)) {
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.setAttribute('aria-label', busy ? 'シェア画像を生成中' : '今日の記録をシェア画像にする');
  }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function buildShareCard(state: AppState, ref: ISODate): Blob | null {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const font = (size: number, weight = 700) => `${weight} ${size}px 'Noto Sans JP Variable', 'Noto Sans JP', sans-serif`;

  // 集計
  const minutesByDate = new Map<ISODate, number>();
  for (const s of state.sessions) minutesByDate.set(s.date, (minutesByDate.get(s.date) ?? 0) + s.minutes);
  const todayMin = minutesByDate.get(ref) ?? 0;
  const weekFrom = addDays(ref, -6);
  let weekMin = 0;
  for (const [d, m] of minutesByDate) if (d >= weekFrom && d <= ref) weekMin += m;
  let streak = 0;
  {
    let d = ref;
    if ((minutesByDate.get(d) ?? 0) <= 0) d = addDays(d, -1);
    while ((minutesByDate.get(d) ?? 0) > 0) {
      streak++;
      d = addDays(d, -1);
    }
  }
  const bySubject = new Map<string, number>();
  for (const s of state.sessions) {
    if (s.date >= weekFrom && s.date <= ref) bySubject.set(s.subjectId, (bySubject.get(s.subjectId) ?? 0) + s.minutes);
  }
  const topSubjects = [...bySubject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxSubj = Math.max(1, ...topSubjects.map(([, m]) => m));

  // 背景
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b0f1a');
  bg.addColorStop(1, '#141b30');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -200, 0, W / 2, -200, 900);
  glow.addColorStop(0, 'rgba(79,124,255,0.35)');
  glow.addColorStop(1, 'rgba(79,124,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ヘッダー
  ctx.fillStyle = '#e8ecf8';
  ctx.font = font(44, 800);
  ctx.textBaseline = 'middle';
  ctx.fillText('🎯 StudyCommander', 72, 110);
  ctx.fillStyle = '#9aa5c4';
  ctx.font = font(34, 600);
  const [y, m, d] = ref.split('-');
  ctx.fillText(`${y}年${Number(m)}月${Number(d)}日の学習記録`, 72, 178);

  // メイン数値
  ctx.fillStyle = '#ffffff';
  ctx.font = font(150, 800);
  ctx.fillText(formatMinutes(todayMin), 72, 340);
  ctx.fillStyle = '#9aa5c4';
  ctx.font = font(36, 700);
  ctx.fillText('今日の勉強時間', 72, 445);

  // サブ統計カード
  const stats: [string, string][] = [
    [`🔥 ${streak}日`, '連続学習'],
    [formatMinutes(weekMin), '直近7日'],
  ];
  if (state.goal) {
    const daysToExam = diffDays(ref, state.goal.examDate);
    const examLabel = daysToExam > 0 ? `あと${daysToExam}日` : daysToExam === 0 ? '今日' : `${Math.abs(daysToExam)}日経過`;
    stats.push([examLabel, state.goal.name]);
  }
  const cardW = (W - 72 * 2 - 24 * (stats.length - 1)) / stats.length;
  stats.forEach(([v, label], i) => {
    const x = 72 + i * (cardW + 24);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    rr(ctx, x, 510, cardW, 170, 28);
    ctx.fill();
    ctx.fillStyle = '#e8ecf8';
    ctx.font = font(46, 800);
    const vw = ctx.measureText(v).width;
    ctx.fillText(v, x + (cardW - vw) / 2, 580);
    ctx.fillStyle = '#9aa5c4';
    ctx.font = font(28, 600);
    const lw = ctx.measureText(label).width;
    ctx.fillText(label, x + (cardW - lw) / 2, 640);
  });

  // 科目別バー
  let barY = 780;
  if (topSubjects.length > 0) {
    ctx.fillStyle = '#9aa5c4';
    ctx.font = font(32, 700);
    ctx.fillText('直近7日の科目トップ3', 72, barY - 40);
    for (const [sid, min] of topSubjects) {
      const subject = state.subjects.find((s) => s.id === sid);
      ctx.fillStyle = '#e8ecf8';
      ctx.font = font(34, 800);
      ctx.fillText(subject?.name ?? '不明', 72, barY + 22);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      rr(ctx, 300, barY, W - 300 - 72 - 170, 44, 22);
      ctx.fill();
      ctx.fillStyle = subject?.color ?? '#4f7cff';
      rr(ctx, 300, barY, Math.max(44, (W - 300 - 72 - 170) * (min / maxSubj)), 44, 22);
      ctx.fill();
      ctx.fillStyle = '#9aa5c4';
      ctx.font = font(30, 700);
      ctx.fillText(formatMinutes(min), W - 72 - 150, barY + 22);
      barY += 92;
    }
  }

  // フッター
  ctx.fillStyle = '#66718f';
  ctx.font = font(28, 600);
  ctx.fillText('#StudyCommander で毎日の計画を自動再設計', 72, H - 80);

  // toBlobは非同期だがdataURL経由で同期的にBlob化する(共有はユーザー操作起点が必要なため)
  const dataUrl = canvas.toDataURL('image/png');
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

async function performShareStudyCard(state: AppState, ref: ISODate): Promise<ShareStudyCardResult> {
  try {
    // Canvas生成・PNG変換は端末のメモリ不足や実装制限で例外になることがある。
    // 呼び出し側へ例外を漏らさず、必ず利用者向けの失敗表示へ変換する。
    const blob = buildShareCard(state, ref);
    if (!blob) return 'failed';
    const file = new File([blob], `studycommander-${ref}.png`, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'StudyCommander 学習記録' });
        return 'shared';
      }
    } catch (e) {
      // 利用者による共有シートのキャンセルは成功でも障害でもないため、独立した結果として返す。
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // 共有失敗時はダウンロードへ
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studycommander-${ref}.png`;
    a.click();
    // iOS Safariではclick直後のURL解放でダウンロード開始前に参照が失われる場合がある。
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

export function shareStudyCard(state: AppState, ref: ISODate): Promise<ShareStudyCardResult> {
  // 共有シート表示中の連打でCanvas生成や共有要求を重複させず、進行中の結果を共有する。
  if (shareInFlight) return shareInFlight;
  setShareButtonBusy(true);
  shareInFlight = performShareStudyCard(state, ref).finally(() => {
    shareInFlight = null;
    setShareButtonBusy(false);
  });
  return shareInFlight;
}
