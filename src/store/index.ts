import { useStore } from 'zustand';

import {
  createProjectStore,
  type ProjectStoreApi,
  type ProjectStoreState,
} from './projectStore';

export type {
  CreateProjectStoreOptions,
  PersistenceState,
  ProjectImportResult,
  ProjectStoreApi,
  ProjectStoreState,
} from './projectStore';
export {
  PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_VERSION,
  getBrowserProjectStorage,
  loadStoredProject,
  saveStoredProject,
  type ProjectStorage,
} from './persistence';
export { createProjectStore } from './projectStore';

export const projectStore = createProjectStore();

export function useProjectStore(): ProjectStoreState;
export function useProjectStore<T>(
  selector: (state: ProjectStoreState) => T,
): T;
export function useProjectStore<T>(
  selector?: (state: ProjectStoreState) => T,
): T | ProjectStoreState {
  const select =
    selector ?? ((state: ProjectStoreState): ProjectStoreState => state);
  return useStore<ProjectStoreApi, T | ProjectStoreState>(
    projectStore,
    select,
  );
}

export function useGraphDocument() {
  return useProjectStore((state) => state.document);
}

export function useSelectedNodeId() {
  return useProjectStore((state) => state.selectedNodeId);
}

export function usePlaying() {
  return useProjectStore((state) => state.playing);
}
