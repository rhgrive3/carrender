import { MemoryEditor } from './MemoryEditor';
import { MemoryHome } from './MemoryHome';
import { MemoryImportExport } from './MemoryImportExport';
import { MemoryResult } from './MemoryResult';
import { MemorySetDetail } from './MemorySetDetail';
import { MemoryStudy } from './MemoryStudy';
import { MemoryStudySetup } from './MemoryStudySetup';
import { useMemory } from './MemoryContext';

export function MemoryFeature() {
  const { view } = useMemory();
  switch (view.name) {
    case 'home': return <MemoryHome />;
    case 'set': return <MemorySetDetail setId={view.setId} />;
    case 'editor': return <MemoryEditor setId={view.setId} itemId={view.itemId} bulk={view.bulk} />;
    case 'import': return <MemoryImportExport setId={view.setId} />;
    case 'studySetup': return <MemoryStudySetup initialSetIds={view.setIds} />;
    case 'study': return <MemoryStudy sessionId={view.sessionId} />;
    case 'result': return <MemoryResult sessionId={view.sessionId} />;
    case 'analytics': return <MemoryHome />;
  }
}

export { MemoryProvider, useMemory } from './MemoryContext';
