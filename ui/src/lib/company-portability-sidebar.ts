/**
 * FILE: ui/src/lib/company-portability-sidebar.ts
 * ABOUT: company-portability-sidebar.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - company-portability-sidebar.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: company-portability-sidebar.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/company-portability-sidebar.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Agent, CompanyPortabilitySidebarOrder, Project } from "@paperclipai/shared";
import { deriveProjectUrlKey, normalizeAgentUrlKey } from "@paperclipai/shared";

function uniqueSlug(base: string, used: Set<string>) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let index = 2;
  while (true) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    index += 1;
  }
}

export function buildPortableAgentSlugMap(agents: Agent[]): Map<string, string> {
  const usedSlugs = new Set<string>();
  const byId = new Map<string, string>();
  const sortedAgents = [...agents].sort((left, right) => left.name.localeCompare(right.name));

  for (const agent of sortedAgents) {
    const baseSlug = normalizeAgentUrlKey(agent.name) ?? "agent";
    byId.set(agent.id, uniqueSlug(baseSlug, usedSlugs));
  }

  return byId;
}

export function buildPortableProjectSlugMap(projects: Project[]): Map<string, string> {
  const usedSlugs = new Set<string>();
  const byId = new Map<string, string>();
  const sortedProjects = [...projects].sort((left, right) => left.name.localeCompare(right.name));

  for (const project of sortedProjects) {
    const baseSlug = deriveProjectUrlKey(project.name, project.name);
    byId.set(project.id, uniqueSlug(baseSlug, usedSlugs));
  }

  return byId;
}

export function buildPortableSidebarOrder(input: {
  agents: Agent[];
  orderedAgents: Agent[];
  projects: Project[];
  orderedProjects: Project[];
}): CompanyPortabilitySidebarOrder | undefined {
  const agentSlugById = buildPortableAgentSlugMap(input.agents);
  const projectSlugById = buildPortableProjectSlugMap(input.projects);
  const sidebar = {
    agents: input.orderedAgents.map((agent) => agentSlugById.get(agent.id)).filter((slug): slug is string => Boolean(slug)),
    projects: input.orderedProjects.map((project) => projectSlugById.get(project.id)).filter((slug): slug is string => Boolean(slug)),
  };

  return sidebar.agents.length > 0 || sidebar.projects.length > 0 ? sidebar : undefined;
}
// [END: module]
