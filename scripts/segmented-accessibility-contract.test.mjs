import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ui/bits.tsx', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../src/lib/radiogroupKeyboardGuard.ts', import.meta.url), 'utf8');
const chartGuard = readFileSync(new URL('../src/lib/chartAccessibleDataGuard.ts', import.meta.url), 'utf8');
const recordTabs = readFileSync(new URL('../src/lib/recordTabPanelSemantics.ts', import.meta.url), 'utf8');
const material = readFileSync(new URL('../src/components/materials/MaterialFormSheet.tsx', import.meta.url), 'utf8');
const records = readFileSync(new URL('../src/screens/RecordsScreen.tsx', import.meta.url), 'utf8');
const monthCalendar = readFileSync(new URL('../src/components/ui/MonthCalendar.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const segmented = source.match(/export function Segmented<[\s\S]*?\n}\n\nexport function EmptyState/)?.[0] ?? '';

assert.ok(segmented, '共通Segmentedコンポーネントが見つかる');
assert.match(segmented, /role="radiogroup"[\s\S]*aria-orientation="horizontal"/, '横方向の選択グループであることを公開する');
assert.match(segmented, /tabIndex=\{value === o\.value \? 0 : -1\}/, '選択中の項目だけをTab停止位置にする');
assert.match(segmented, /ArrowRight[\s\S]*ArrowDown[\s\S]*ArrowLeft[\s\S]*ArrowUp/, '方向キーで前後の項目へ移動できる');
assert.match(segmented, /event\.key === 'Home'[\s\S]*event\.key === 'End'/, 'HomeとEndで先頭・末尾へ移動できる');
assert.match(segmented, /event\.preventDefault\(\)[\s\S]*onChange\(next\.value\)[\s\S]*target\?\.focus\(\)/, '選択変更とフォーカス移動を同期する');
assert.match(segmented, /data-segment-value=\{o\.value\}/, '移動先を安定して特定する');

assert.match(material, /role="radiogroup" aria-label="周回"/, '教材の周回選択をradiogroupとして公開する');
assert.match(guard, /return role === 'radio' \? 'aria-checked' : 'aria-selected'/, 'radioとtabで正しいARIA選択属性を参照する');
assert.match(guard, /choice\.hasAttribute\('disabled'\) \|\| choice\.getAttribute\('aria-disabled'\) === 'true'/, 'ネイティブとARIAの両方の無効状態を扱う');
assert.match(guard, /if \(isDisabledChoice\(choice\)\) choice\.tabIndex = -1/, '無効化前のTab停止位置を確実に除去する');
assert.match(guard, /const selected = choices\.find\([\s\S]*choice\.tabIndex = choice === selected \? 0 : -1/, '不完全なradiogroupとtablistも選択中だけをTab停止位置へ修復する');
assert.match(guard, /if \(isDisabledChoice\(choice\)\) return[\s\S]*enabledChoicesOf\(group, role\)/, '無効な現在項目を操作せず移動先からも除外する');
assert.match(guard, /role === 'radio'[\s\S]*ArrowRight[\s\S]*ArrowDown[\s\S]*ArrowLeft[\s\S]*ArrowUp/, 'radiogroupへ4方向キーを補完する');
assert.match(guard, /const vertical = group\.getAttribute\('aria-orientation'\) === 'vertical'[\s\S]*vertical \? 'ArrowDown' : 'ArrowRight'[\s\S]*vertical \? 'ArrowUp' : 'ArrowLeft'/, 'tablistはorientationに応じた方向キーだけを処理する');
assert.match(guard, /event\.key === 'Home'[\s\S]*event\.key === 'End'/, '全選択グループへHomeとEndを補完する');
assert.match(guard, /if \(event\.defaultPrevented\) return/, '既存コンポーネントが処理済みのキーを二重処理しない');
assert.match(guard, /event\.preventDefault\(\)[\s\S]*next\.click\(\)[\s\S]*next\.focus\(\)/, 'キーボード移動でReactの選択処理とフォーカスを同期する');
assert.match(guard, /document\.querySelectorAll\(RADIOGROUP_SELECTOR\)[\s\S]*document\.querySelectorAll\(TABLIST_SELECTOR\)/, 'radiogroupとtablistを独立して正規化する');
assert.match(guard, /role !== 'radio' && role !== 'tab'/, 'radioとtabの両方をキーボード補修対象にする');
assert.match(guard, /repairPlanViewGroup\(\)[\s\S]*setAttributeIfChanged\(group, 'role', 'radiogroup'\)[\s\S]*aria-checked/, '計画の週月切替を完全なradiogroupへ補修する');
assert.match(guard, /repairRecordLogButtons\(\)[\s\S]*dateContext[\s\S]*task-title[\s\S]*task-range[\s\S]*記録を編集/, '学習ログの可視情報を編集ボタンの名称へ含める');
assert.match(guard, /repairAchievementBadges\(\)[\s\S]*role', 'progressbar'[\s\S]*aria-valuenow[\s\S]*aria-valuetext/, '実績バッジの説明と進捗を支援技術へ公開する');
assert.match(guard, /MEMORY_CARD_FACE_SELECTOR[\s\S]*event\.key === 'Enter'[\s\S]*aria-hidden[\s\S]*focus\(\{ preventScroll: true \}\)/, 'キーボード反転後に表示面へフォーカスを移す');
assert.match(guard, /attributeFilter: \['aria-checked', 'aria-selected', 'aria-disabled', 'aria-orientation', 'aria-hidden', 'disabled', 'role', 'class'\]/, '選択・表示面・class変更後も補修を再実行する');

assert.match(chartGuard, /summarizeWeek\(state, start\)[\s\S]*日別の予定・実績を表で見る[\s\S]*科目別内訳/, '週グラフと同じ端末stateから日別予定・実績・科目内訳表を生成する');
assert.match(chartGuard, /computeAnalytics\(state, today\(\)\)\.heatmap[\s\S]*過去12週間の学習時間を一覧で見る/, '12週間ヒートマップと同じanalytics selectorから学習日一覧を生成する');
assert.match(chartGuard, /plannedMaterialAmountThrough[\s\S]*actualMaterialAmountThrough[\s\S]*教材別の現在達成率を表で見る/, '教材達成率の目標・実績をproduction selectorから表へ再構成する');
assert.match(chartGuard, /aria-describedby[\s\S]*ensureDescription/, '各視覚グラフを数値要約へ関連付ける');
assert.match(chartGuard, /data-chart-accessible-data[\s\S]*dataset\.chartAccessibleData === signature/, '同じ内容で代替DOMを作り直さずobserver循環を防ぐ');
assert.match(chartGuard, /requestAnimationFrame[\s\S]*MutationObserver/, '期間切替・lazy描画後に一度だけ再構築する');

assert.match(records, /role="tablist" aria-label="記録画面の切替"[\s\S]*role="tab"[\s\S]*role="tab"/, '記録画面切替をtablistとして公開する');
assert.match(records, /role="tablist" aria-label="集計期間"[\s\S]*role="tab"[\s\S]*role="tab"/, '週月切替をtablistとして公開する');
assert.match(monthCalendar, /data-month-calendar/, '月表示の実DOMへ安定した識別子を持つ');
assert.match(recordTabs, /export function installRecordTabPanelSemanticsGuard\(\)/, '記録画面のtabとtabpanelを接続する共有ガードを持つ');
assert.match(recordTabs, /overviewTab\.id = 'records-overview-tab'[\s\S]*aria-controls', 'records-overview-panel'/, '集計tabから集計panelを参照する');
assert.match(recordTabs, /logTab\.id = 'records-log-tab'[\s\S]*aria-controls', 'records-log-panel'/, '学習ログtabからログpanelを参照する');
assert.match(recordTabs, /overviewPanel\.id = 'records-overview-panel'[\s\S]*setAttribute\('role', 'tabpanel'\)[\s\S]*setAttribute\('aria-labelledby', overviewTab\.id\)/, '集計panelから集計tabを参照する');
assert.match(recordTabs, /logPanel\.id = 'records-log-panel'[\s\S]*setAttribute\('role', 'tabpanel'\)[\s\S]*setAttribute\('aria-labelledby', logTab\.id\)/, 'ログpanelからログtabを参照する');
assert.match(recordTabs, /weekTab\.id = 'records-week-tab'[\s\S]*aria-controls', 'records-week-panel'/, '週tabから週panelを参照する');
assert.match(recordTabs, /monthTab\.id = 'records-month-tab'[\s\S]*aria-controls', 'records-month-panel'/, '月tabから月panelを参照する');
assert.match(recordTabs, /querySelector<HTMLElement>\('\[data-month-calendar\]'\)\?\.closest<HTMLElement>\('\.card'\)/, '月tabpanelはMonthCalendarの実DOMから解決する');
assert.match(recordTabs, /periodPanel\.id = periodPanelId[\s\S]*setAttribute\('role', 'tabpanel'\)[\s\S]*setAttribute\('aria-labelledby', selectedPeriodTab\.id\)/, '表示中の期間panelを選択tabへ関連付ける');
assert.match(recordTabs, /attributeFilter: \['aria-selected'\]/, 'Reactのtab選択変更後に関連付けを再構築する');
assert.match(main, /installRadiogroupKeyboardGuard\(\);/, 'アプリ起動時に共有選択グループガードを有効化する');
assert.match(main, /installRecordTabPanelSemanticsGuard\(\);/, 'アプリ起動時に記録tabpanelガードを有効化する');
assert.match(main, /installChartAccessibleDataGuard\(\);/, 'アプリ起動時にグラフ代替データガードを有効化する');

console.log('✅ selection groups, chart alternatives, and main feature accessibility repairs passed');
