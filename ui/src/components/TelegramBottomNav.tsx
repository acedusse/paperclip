/**
 * FILE: ui/src/components/TelegramBottomNav.tsx
 * ABOUT: TelegramBottomNav.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - the six-surface bottom nav shown inside a Telegram Mini App.
 */
// ==========================================
// [META: module]
// INTENT: Give the Mini App the six surfaces the operator asked Telegram to expose. Deliberately a
//   separate component from MobileBottomNav: that one answers "what does a phone user reach for",
//   this one answers "what did the operator ask Telegram to expose", and merging them makes both worse.
//   Uses the @/lib/router company-prefix shim, same as MobileBottomNav — every board route (including
//   the fixed items below) only exists as `:companyPrefix/<path>` inside boardRoutes() (App.tsx); there
//   is no unprefixed `/dashboard`, `/approvals/triage`, `/digest`, `/artifacts` or `/plugins/:id` route,
//   so an absolute `to` needs the shim's prefix injection to resolve to anything but the 404 page.
//   TelegramAppRedirect (App.tsx) already lands the user on `/:prefix/dashboard?c=X` before this nav
//   ever renders, so the prefix param the shim reads is populated by the time it matters.
// PSEUDOCODE: 1. Declare the five fixed-route items. 2. Look up installed plugin UI contributions.
//   3. Find one whose pluginKey/displayName look like a wiki and that declares a page slot. 4. Append a
//   Wikis item pointing at /plugins/:pluginId when found. 5. Render a fixed bottom bar of NavLinks.
// JSON_FLOW: {"file": "ui/src/components/TelegramBottomNav.tsx", "imports": "@/lib/router, @tanstack/react-query, lucide-react, @/api/plugins, @/lib/queryKeys, ../lib/utils", "exports": "TelegramBottomNav, TELEGRAM_NAV_ITEMS, WIKI_PLUGIN_MATCH"}
// ==========================================
// [START: module]
import { NavLink } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CircleDot, FileText, House, LayoutGrid, ShieldCheck } from "lucide-react";
import { pluginsApi, type PluginUiContribution } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "../lib/utils";

/**
 * Five fixed routes. Wikis is deliberately absent: it is a *plugin* surface, not a core route, and
 * its target depends on which plugin is installed — see findWikiContribution below.
 */
export const TELEGRAM_NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: House },
  { to: "/issues", label: "Tasks", icon: CircleDot },
  { to: "/approvals/triage", label: "Triage", icon: ShieldCheck },
  { to: "/digest", label: "Digest", icon: FileText },
  { to: "/artifacts", label: "Artifacts", icon: LayoutGrid },
] as const;

/**
 * There is no `/wikis` route. Plugin UIs mount at `/plugins/:pluginId` (App.tsx:125) and plugins may
 * also declare their own `:pluginRoutePath/*` (App.tsx:198), so the wiki entry has to be resolved from
 * the installed-plugin list at runtime rather than hardcoded. When no wiki plugin is installed the slot
 * renders nothing and the nav is five items wide.
 */
export const WIKI_PLUGIN_MATCH = /wiki/i;

/**
 * Identify the installed wiki plugin, if any, from the `/api/plugins/ui-contributions` response.
 *
 * `contribution.pluginId` is the plugin's opaque database id (e.g. `plg_123`) — it never contains a
 * human-readable name, so matching against it would never succeed. `pluginKey` is the manifest's stable
 * string id (e.g. `paperclipai.plugin-llm-wiki`) and `displayName` is operator-facing ("LLM Wiki");
 * either is a reasonable name signal. A name match alone isn't enough to link to, though: `/plugins/:id`
 * only renders something when the plugin declares a `page` slot (see PluginPage.tsx) — without one the
 * host redirects to plugin settings, which would make a nav item labelled "Wikis" a dead end.
 */
function findWikiContribution(contributions: PluginUiContribution[] | undefined): PluginUiContribution | null {
  if (!contributions) return null;
  return (
    contributions.find((contribution) => {
      const nameMatches =
        WIKI_PLUGIN_MATCH.test(contribution.pluginKey) || WIKI_PLUGIN_MATCH.test(contribution.displayName);
      if (!nameMatches) return false;
      return contribution.slots.some((slot) => slot.type === "page");
    }) ?? null
  );
}

export function TelegramBottomNav() {
  // The wiki plugin's route is discovered, never assumed. `pluginsApi` is the same source the sidebar's
  // launcher outlet reads (ui/src/plugins/launchers.tsx) — that file owns the contribution shape.
  const { data: contributions } = useQuery({
    queryKey: queryKeys.plugins.uiContributions,
    queryFn: () => pluginsApi.listUiContributions(),
  });
  const wiki = findWikiContribution(contributions);
  const items = [
    ...TELEGRAM_NAV_ITEMS,
    ...(wiki ? [{ to: `/plugins/${wiki.pluginId}`, label: "Wikis", icon: BookOpen } as const] : []),
  ];

  return (
    <nav
      aria-label="Telegram navigation"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="telegram-bottom-nav fixed inset-x-0 bottom-0 z-40 grid border-t border-border bg-background"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium",
                isActive ? "text-primary" : "text-muted-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
// [END: module]
