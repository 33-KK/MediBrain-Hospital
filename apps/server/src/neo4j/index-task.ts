import { randomUUID } from 'crypto';

export interface IndexTask {
  key: string;
  name: string;
  label: string;
  revision: string;
}

export function indexTasks(label: string, ...names: string[]): IndexTask[] {
  return [...new Set(names)].map((name) => ({
    key: JSON.stringify([label, name]),
    name,
    label,
    revision: randomUUID(),
  }));
}

// Append to the mutation query so graph changes and index tasks commit together.
export const WRITE_INDEX_TASKS = `
  UNWIND $indexTasks AS event
  MERGE (task:_MediBrainIndexTask {key: event.key})
  SET task.name = event.name, task.label = event.label,
      task.revision = event.revision, task.updatedAt = timestamp()
`;
