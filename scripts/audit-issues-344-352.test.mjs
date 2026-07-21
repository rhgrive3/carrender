import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const timer = read('src/components/timer/TimerContext.tsx');
const record = read('src/components/forms/RecordSheet.tsx');
const app = read('src/state/AppContext.tsx');
const material = read('src/components/materials/MaterialFormSheet.tsx');
const memoryResult = read('src/features/memory/ui/MemoryResult.tsx');
const memorySetup = read('src/features/memory/ui/MemoryStudySetup.tsx');
const memoryStudy = read('src/features/memory/ui/MemoryStudy.tsx');
const records = read('src/screens/RecordsScreen.tsx');
const shares = read('src/lib/recordChartShares.ts');

assert.match(timer, /workStartedAt\?: number/, 'timer persistence must keep an immutable study start');
assert.match(timer, /workStartedAt: nowMs/, 'new timers must capture the first start instant');
assert.match(timer, /startedAt: persisted\?\.workStartedAt \? new Date/, 'timer context must expose the start to recording');
assert.match(record, /const timerStartedAt = preset\?\.source === 'timer' \? timer\.startedAt : null/, 'timer record sheet must consume the actual start');
assert.match(record, /date: usesExplicitStart \? recordDate : undefined/, 'timer start date must reach the session input');
assert.match(record, /startTime: usesExplicitStart \? startTime : undefined/, 'timer start time must reach the session input');

assert.match(app, /function hasSameEstimateObservation/, 'non-measurement record edits need an idempotence boundary');
assert.match(app, /preserveMaterialEstimates\(state, next\)/, 'unchanged observations must not drift estimates');
assert.match(app, /completedRanges: action\.material\.completedRanges/, 'confirmed material ranges must survive the reducer boundary');
assert.match(material, /doneAmount > totalAmount/, 'done amount above total must be rejected');
assert.match(material, /cadenceCount < 1 \|\| cadenceCount > 7/, 'weekly cadence must match calendar semantics');
assert.match(material, /最大チャンクは最小チャンク以上/, 'inverted chunk limits must be explicit errors');
assert.match(material, /parseReviewIntervals/, 'review intervals must be parsed strictly');
assert.match(material, /const cadenceSummary = cadence === 'auto'/, 'collapsed material summary must reflect the current cadence');
assert.match(material, /完了範囲が/, 'destructive range edits must be confirmed');

assert.match(record, /const activeTaskTarget = hasTaskTarget && keepsSameTaskTarget/, 'task completion UI must follow the actual saved reference');
assert.match(record, /元のタスクとの紐付けを解除します/, 'unlinking a task record must be visible before save');
assert.match(record, /元のタスクは未完了へ戻り/, 'unlink save must explain its scheduling impact');

assert.match(memoryResult, /export function summarizeMemoryCardOutcomes/, 'memory result needs a card-level summary helper');
assert.match(memoryResult, /const initial = \[\.\.\.new Set\(session\.initialTargetIds\)\]/, 'memory cards must be counted uniquely');
assert.doesNotMatch(memoryResult, /attempts\.filter\(\(attempt\) => attempt\.assessment === 'correct'\)\.length/, 'raw answer counts must not be labeled as card counts');
assert.match(memorySetup, /activeSession && !window\.confirm/, 'all setup-based starts must protect an active session');
assert.match(memorySetup, /前回の続きへ戻る/, 'setup must offer a non-destructive resume path');

assert.match(memoryStudy, /createPortal/, 'full-screen memory study must be portalled outside the inert app root');
assert.match(memoryStudy, /acquireModalIsolation\(root\)/, 'memory study must isolate background UI');
assert.match(memoryStudy, /trapModalTabKey\(event, root\)/, 'memory study must trap keyboard focus');
assert.match(memoryStudy, /event\.isComposing \|\| event\.keyCode === 229/, 'IME Escape must not close study');
assert.match(memoryStudy, /role="button" className="memory-study-card-face/, 'card faces must use valid non-button containers for headings');
assert.doesNotMatch(memoryStudy, /<button[\s\S]{0,120}className="memory-study-card-face/, 'invalid button-wrapped headings must not return');

assert.match(records, /recordChartSharePercent\(minutes, actual\)/, 'React must render chart shares from numeric source data');
assert.doesNotMatch(records, /Math\.max\(8,/, 'small categories must not inflate stacked percentages');
assert.match(shares, /value \/ total/, 'chart helper must calculate exact proportions');
assert.doesNotMatch(records, /minutesFromTitle|MutationObserver/, 'chart rendering must not parse localized DOM text');

console.log('audit issues #344-#352 regression contracts passed');
