/**
 * What the plant room shows as under way: an AUGUR upgrade the updater is
 * running, and installs and removals the app runner is running. The shapes
 * are the registry's (contracts/registry.openapi.yaml), read as an admin.
 */

export type StepState = 'running' | 'done' | 'failed';

export interface JobStep {
  step: string;
  state: StepState;
  at: string;
  message?: string;
}

/** An AUGUR upgrade an admin asked for, and how the deployment's updater is getting on. */
export interface PlatformUpgrade {
  id: string;
  from: string;
  version: string;
  requestedAt: string;
  state: 'requested' | 'running' | 'done' | 'rolled-back' | 'failed' | 'cancelled';
  steps: JobStep[];
  message?: string;
  finishedAt?: string;
}

/** An install or removal the app runner was asked for. */
export interface AppJob {
  id: string;
  app: string;
  action: 'install' | 'remove';
  release?: { version: string; channel: string };
  requestedAt: string;
  state: 'requested' | 'running' | 'done' | 'failed' | 'cancelled';
  steps: JobStep[];
  message?: string;
  finishedAt?: string;
}

export interface RunnerJobs {
  jobs: AppJob[];
  /** When the app runner last asked for work; absent when it hasn't since the registry started. */
  runnerSeenAt?: string;
}

export interface Preview {
  pr: number;
  version: string;
  title?: string;
  endsAt: string;
}

/** The apps the app runner installed, with any pull request previews running beside them. */
export interface Installs {
  installed: { app: string; name: string; version: string; previews?: Preview[] }[];
  runnerSeenAt?: string;
}

/** An upgrade's steps in order, in words; rolling back shows only when it happened. */
export const UPGRADE_STEPS: [string, string][] = [
  ['preflight', 'Checks'],
  ['backup', 'Backup'],
  ['pull', 'Fetch'],
  ['roll-forward', 'Roll forward'],
  ['verify', 'Verify'],
  ['roll-back', 'Roll back'],
];

/** An install's steps in order, in words; a removal has only its own. */
export const INSTALL_STEPS: [string, string][] = [
  ['verify', 'Signature'],
  ['storage', 'Storage'],
  ['sign-in', 'Sign-in'],
  ['start', 'Start'],
  ['health', 'Health'],
  ['switch', 'Switch over'],
  ['retire', 'Retire old'],
];
export const REMOVE_STEPS: [string, string][] = [['remove', 'Remove']];

export interface TrackStop {
  step: string;
  label: string;
  state: StepState | 'waiting';
  message?: string;
}

/** The stops on a job's track, each as far as the job has got: a step not reached yet is waiting. */
export const trackOf = (order: [string, string][], steps: JobStep[]): TrackStop[] =>
  order
    .filter(([step]) => step !== 'roll-back' || steps.some((s) => s.step === step))
    .map(([step, label]) => {
      const seen = steps.find((s) => s.step === step);
      return { step, label, state: seen?.state ?? 'waiting', ...(seen?.message ? { message: seen.message } : {}) };
    });

const LIVE = new Set(['requested', 'running']);
/** A finished job stays on the plant room this long. */
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether a job is still waiting or running. */
export const isLive = (job: { state: string }) => LIVE.has(job.state);

/** Finished within the week, newest first: what the plant room tells as just done. */
export const recent = <J extends { state: string; finishedAt?: string; requestedAt: string }>(jobs: J[], now = Date.now()) =>
  jobs
    .filter((j) => !isLive(j) && now - Date.parse(j.finishedAt ?? j.requestedAt) < RECENT_MS)
    .sort((a, b) => Date.parse(b.finishedAt ?? b.requestedAt) - Date.parse(a.finishedAt ?? a.requestedAt));

/** One job in words: "Folio 0.9.1: installing", "AUGUR 0.8.0: rolled back". */
export const jobLine = (job: AppJob, name: string) => {
  const what = job.action === 'remove' ? name : `${name}${job.release ? ` ${job.release.version}` : ''}`;
  const verb = job.action === 'remove' ? { requested: 'waiting to be removed', running: 'being removed', done: 'removed', failed: 'couldn’t be removed', cancelled: 'removal called off' } : { requested: 'waiting to install', running: 'installing', done: 'installed', failed: 'couldn’t install', cancelled: 'install called off' };
  return `${what}: ${verb[job.state]}`;
};

export const upgradeLine = (u: PlatformUpgrade) =>
  `AUGUR ${u.from} to ${u.version}: ${{ requested: 'waiting for the updater', running: 'upgrading', done: 'done', 'rolled-back': 'rolled back, still on ' + u.from, failed: 'stopped, needs a person', cancelled: 'called off' }[u.state]}`;
