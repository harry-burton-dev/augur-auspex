/**
 * What Auspex reads. Your map comes from identity and the apps on a floor
 * from the registry, both straight through the gateway as the person, so
 * Auspex never sees more than they could ask for themselves. Only what
 * changed lately comes from Auspex's own service.
 */

import { AppError } from '@augur/app-kit';
import type { Changes, Names } from '../../service/src/api-types.js';
import type { Installs, PlatformUpgrade, RunnerJobs } from './jobs.js';
import { APP_NAME } from './words.js';

// Explorer's own service's wire types are written once, in the service's api-types.ts, and shared with it.
export type { Change, ChangeKind, Changes } from '../../service/src/api-types.js';

export type FloorKind = 'personal' | 'team' | 'org';
export type MemberRole = 'member' | 'lead';

export interface Named {
  id: string;
  name: string;
}

/** Why someone can stand on, or see into, a floor (identity's `FloorReason`). */
export type FloorReason =
  | { kind: 'own' }
  | { kind: 'org' }
  | { kind: 'member'; role: MemberRole }
  | { kind: 'inside'; via: Named }
  | { kind: 'leads-above'; team: Named }
  | { kind: 'admin' };

export interface MapFloor {
  id: string;
  kind: FloorKind;
  name: string;
  slug: string;
  parentId?: string;
  depth: number;
  /** False for a team they see into (as a lead above it, or an admin) without standing on it. */
  open: boolean;
  why: FloorReason;
  people: number;
  leads: Named[];
  members?: (Named & { role: MemberRole })[];
}

export interface ClosedTeam {
  id: string;
  name: string;
  parentId?: string;
  depth: number;
  leads: Named[];
}

export interface PersonMap {
  floors: MapFloor[];
  closed: ClosedTeam[];
  principals: string[];
}

/** Why an app is on or off on a floor (the registry's `floorState`, with who set the deciding rule). */
export type AppState =
  | { on: true; why: 'platform' }
  | { on: true; why: 'approved' }
  | { on: false; why: 'turned-off' }
  | { on: false; why: 'not-for-this-kind' }
  | { on: false; why: 'blocked'; by: string; setBy?: string; setAt?: string }
  | { on: boolean; why: 'set-here' | 'set-above'; by: string; setBy?: string; setAt?: string };

export interface FloorApp {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  floors?: FloorKind[];
  /** The kind in force (ADR 0032): a platform app, for using and managing AUGUR, or a pillar app, the foundation of its output. */
  category?: 'platform' | 'pillar';
  /** It ships with AUGUR: an admin can turn it off, not remove it. */
  ships?: boolean;
  /** The registry's old name for `ships`. */
  pillar?: boolean;
  state: AppState;
  requiredRole?: string;
  hasRole?: boolean;
}

/** One part of AUGUR as the gateway last found it (the gateway's `/status`, for admins). */
export interface Part {
  name: string;
  kind: 'gateway' | 'service' | 'app' | 'sign-in';
  state: 'up' | 'slow' | 'down' | 'checking';
  version?: string;
  latencyMs?: number;
  checkedAt?: string;
  seenAt?: string;
  problem?: string;
}

export interface BackupRun {
  at: string;
  ok: boolean;
  problem?: string;
}

export interface PlantStatus {
  components: Part[];
  /** Absent when the gateway isn't told where backups are. */
  backups?: { state: 'ok' | 'attention'; problem?: string; lastBackup?: BackupRun; lastRestoreTest?: BackupRun };
}

/** The running release and the newest one out (the registry's Updates view, for admins). */
export interface PlantUpdates {
  running: { version: string; channel: 'stable' | 'beta' };
  feed: 'on' | 'off';
  problem?: string;
  available?: { version: string; released?: string };
  needsYou: { message: string }[];
  /** The upgrade asked for, while it's waiting or under way, and for a week after. */
  upgrade?: PlatformUpgrade;
  /** When the deployment's updater last asked for work, since the registry started. */
  updaterSeenAt?: string;
}

/** Whether the person can use an app on a floor: on there, and they have any role it needs. */
export const usable = (app: FloorApp) => app.state.on && app.hasRole !== false;

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

export class AuspexApi {
  constructor(private fetch: Fetch) {}

  private async get<T>(path: string, floor?: string): Promise<T> {
    // A floor other than the one they're on: the gateway checks they can stand on it.
    let res: Response;
    try {
      res = await this.fetch(path, { headers: { accept: 'application/json', ...(floor ? { 'X-Workspace-Id': floor } : {}) } });
    } catch (err) {
      throw AppError.from(err, { appName: APP_NAME });
    }
    const body: unknown = await res.json().catch(() => undefined);
    // Every failure is an AppError whose message a person can act on: the service's reason, or that it isn't answering.
    if (!res.ok) throw AppError.fromProblem(res.status, body, { appName: APP_NAME });
    return body as T;
  }

  map() {
    return this.get<PersonMap>('/api/identity/v1/me/map');
  }

  /** Every app on a floor they stand on, with why it's on or off. */
  async apps(floor: string) {
    return (await this.get<{ apps: FloorApp[] }>(`/api/registry/v1/me/apps?workspace=${encodeURIComponent(floor)}`, floor)).apps;
  }

  changes(floor: string, days = 7) {
    return this.get<Changes>(`/api/auspex/v1/changes?days=${days}`, floor);
  }

  /** Admins only: every part of AUGUR and whether it's answering, and the backups. */
  status() {
    return this.get<PlantStatus>('/api/gateway/v1/status');
  }

  /** Admins only: the running release, and whether a newer one is out. */
  updates() {
    return this.get<PlantUpdates>('/api/registry/v1/platform/updates');
  }

  /** Admins only: the app runner's recent installs and removals. */
  runnerJobs() {
    return this.get<RunnerJobs>('/api/registry/v1/app-runner/jobs');
  }

  /** Admins only: the apps the app runner installed, and their running previews. */
  installs() {
    return this.get<Installs>('/api/registry/v1/app-runner/apps');
  }

  async names(ids: string[]) {
    if (!ids.length) return {};
    return (await this.get<Names>(`/api/auspex/v1/names?ids=${ids.map(encodeURIComponent).join(',')}`)).names;
  }
}
