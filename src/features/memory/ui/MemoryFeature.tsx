import { Fragment } from 'react';
import { MemoryEditor } from './MemoryEditor';
import { MemoryHome } from './MemoryHome';
import { MemoryImportExport } from './MemoryImportExport';
import { MemoryResult } from './MemoryResult';
import { MemorySetDetail } from './MemorySetDetail';
import { MemoryStudy } from './MemoryStudy';
import { MemoryStudySetup } from './MemoryStudySetup';
import { useMemory } from './MemoryContext';

const MEMORY_SCREEN_LABELS = {
  home: '暗記カード',
  set: '暗記セット',
  editor: '暗記カード編集',
  import: '暗記カード入出力',
  studySetup: '暗記学習設定',
  study: '暗記学習',
  result: '暗記学習結果',
} as const;

const repositoryKeys = new WeakMap<object, string>();
let repositoryKeySequence = 0;

function repositoryScreenKey(repository: object | null): string {
  if (!repository) return 'memory-repository:none';
  const current = repositoryKeys.get(repository);
  if (current) return current;
  repositoryKeySequence += 1;
  const next = `memory-repository:${repositoryKeySequence}`;
  repositoryKeys.set(repository, next);
  return next;
}

export function MemoryFeature() {
  const { view, repository } = useMemory();
  let content: JSX.Element;

  switch (view.name) {
    case 'home': content = <MemoryHome />; break;
    case 'set': content = <MemorySetDetail setId={view.setId} />; break;
    case 'editor': content = <MemoryEditor setId={view.setId} itemId={view.itemId} bulk={view.bulk} />; break;
    case 'import': content = <MemoryImportExport setId={view.setId} />; break;
    case 'studySetup': content = <MemoryStudySetup initialSetIds={view.setIds} />; break;
    case 'study': content = <MemoryStudy sessionId={view.sessionId} />; break;
    case 'result': content = <MemoryResult sessionId={view.sessionId} />; break;
  }

  return (
    <Fragment key={repositoryScreenKey(repository)}>
      <span hidden data-app-screen-label={MEMORY_SCREEN_LABELS[view.name]} />
      {content}
    </Fragment>
  );
}

export { MemoryProvider, useMemory } from './MemoryContext';
