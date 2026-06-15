import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type GitStatus = {
  isRepository: boolean;
  branch: string | null;
  head: string | null;
  dirty: boolean;
  changedFiles: number;
  untrackedFiles: number;
  stagedFiles: number;
  unstagedFiles: number;
  additions: number;
  deletions: number;
  diff: string;
};

export type ProjectSummary = {
  id: string;
  path: string;
  name: string;
  available: boolean;
  git: GitStatus;
  lastOpenedAt: number;
};

export type ProjectState = {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
};

export interface ProjectService {
  list(): Promise<ProjectState>;
  pickDirectory(): Promise<string | null>;
  add(path: string): Promise<ProjectState>;
  select(projectId: string): Promise<ProjectState>;
  refresh(projectId: string): Promise<ProjectState>;
}

export function createProjectService(): ProjectService {
  return isTauri() ? new TauriProjectService() : new DemoProjectService();
}

class TauriProjectService implements ProjectService {
  list(): Promise<ProjectState> {
    return invoke("list_projects");
  }

  async pickDirectory(): Promise<string | null> {
    const selected = await open({ directory: true, multiple: false, title: "添加 Mimodex 项目" });
    return typeof selected === "string" ? selected : null;
  }

  add(path: string): Promise<ProjectState> {
    return invoke("add_project", { path });
  }

  select(projectId: string): Promise<ProjectState> {
    return invoke("select_project", { projectId });
  }

  refresh(projectId: string): Promise<ProjectState> {
    return invoke("refresh_project", { projectId });
  }
}

class DemoProjectService implements ProjectService {
  #state: ProjectState = {
    projects: [demoProject("D:\\0WORKSPACE\\mimodex", "mimodex", "main")],
    selectedProjectId: "d:\\0workspace\\mimodex",
  };

  async list(): Promise<ProjectState> {
    return this.#state;
  }

  async pickDirectory(): Promise<string | null> {
    return "D:\\projects\\fixture";
  }

  async add(path: string): Promise<ProjectState> {
    const project = demoProject(path, projectName(path), "main");
    const existing = this.#state.projects.some((candidate) => candidate.id === project.id);
    this.#state = {
      projects: existing
        ? this.#state.projects.map((candidate) => candidate.id === project.id ? project : candidate)
        : [project, ...this.#state.projects],
      selectedProjectId: project.id,
    };
    return this.#state;
  }

  async select(projectId: string): Promise<ProjectState> {
    this.#state = { ...this.#state, selectedProjectId: projectId };
    return this.#state;
  }

  async refresh(_projectId: string): Promise<ProjectState> {
    return this.#state;
  }
}

function demoProject(path: string, name: string, branch: string): ProjectSummary {
  return {
    id: path.toLowerCase(),
    path,
    name,
    available: true,
    git: {
      isRepository: true,
      branch,
      head: "abc1234",
      dirty: false,
      changedFiles: 0,
      untrackedFiles: 0,
      stagedFiles: 0,
      unstagedFiles: 0,
      additions: 0,
      deletions: 0,
      diff: "",
    },
    lastOpenedAt: Date.now(),
  };
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
