import manifest from '../../manifest.json';
import type { AppState, Change, ClosedTeam, FloorApp, FloorKind, MapFloor, Named } from './api.js';

/**
 * Everything Auspex says, in the words people already use: "inside Finance",
 * "you're a member". Never "principal" or "guardrail". Every "no" says who
 * can change it.
 */

/** The name people see, from the manifest: Explorer. The code name, Auspex, is never shown. */
export const APP_NAME: string = manifest.name;

/** "Sam", "Sam and Jo", "Sam, Jo and Alex". */
export const listOf = (names: string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What kind of floor it is and where it sits: "Team · inside Finance". */
export const floorEyebrow = (floor: Pick<MapFloor, 'kind' | 'parentId'>, byId: Map<string, Named>) => {
  if (floor.kind === 'org') return 'The whole organisation';
  if (floor.kind === 'personal') return 'Your own floor';
  const parent = floor.parentId ? byId.get(floor.parentId) : undefined;
  return parent ? `Team · inside ${parent.name}` : 'Team';
};

/** Why they can come onto a floor, in one line. */
export const whyHere = (floor: MapFloor, org: string) => {
  const { why } = floor;
  switch (why.kind) {
    case 'own':
      return 'Only you can come here';
    case 'org':
      return `Everyone at ${org} can come here`;
    case 'member':
      return why.role === 'lead' ? 'You lead it' : 'You’re a member';
    case 'inside':
      return `You’re here because ${why.via.name} is inside it`;
    case 'leads-above':
      return `You can see in because you lead ${why.team.name}`;
    case 'admin':
      return 'You can see in because you’re an admin';
  }
};

/** Who leads a floor, as a sentence, or nothing when no one does. */
export const ledBy = (leads: Named[], you: string) => {
  if (!leads.length) return '';
  const names = leads.map((l) => (l.id === you ? 'you' : l.name));
  return `${listOf(names).replace(/^you/, 'You')} ${leads.length > 1 || names[0] === 'you' ? 'lead' : 'leads'} it.`;
};

/** Who can let them into a closed team. Only an admin changes who's on a team; its leads are who to ask. */
export const whoCanAdd = (team: Pick<ClosedTeam, 'leads'>) =>
  team.leads.length ? `Ask ${listOf(team.leads.map((l) => l.name))}, who ${team.leads.length > 1 ? 'lead' : 'leads'} it. An admin adds people to teams.` : 'No one leads it yet. An admin adds people to teams.';

const kindWords: Record<FloorKind, string> = { personal: 'your own floor', team: 'teams', org: 'the whole organisation' };

/** One line on an app's state on a floor, saying where it comes from. */
export const appLine = (app: FloorApp, floorName: (id: string) => string, here: string) => {
  if (app.hasRole === false) return `Needs the ${app.requiredRole} role`;
  const s: AppState = app.state;
  switch (s.why) {
    case 'platform':
      return 'Part of AUGUR, on everywhere';
    case 'approved':
      return 'On for everyone';
    case 'turned-off':
      return 'Turned off everywhere';
    case 'not-for-this-kind':
      return `Not made for ${here === 'personal' ? 'your own floor' : kindWords[here as FloorKind]}`;
    case 'blocked':
      return `Blocked by ${floorName(s.by)}`;
    case 'set-here':
      return s.on ? 'Turned on here' : 'Turned off here';
    case 'set-above':
      return `${s.on ? 'Turned on' : 'Turned off'} for ${floorName(s.by)}`;
  }
};

/** The question to ask about an app on a floor: why you can, or why you can't. */
export const appQuestion = (app: FloorApp, floor: string) => (app.state.on && app.hasRole !== false ? `Why can I use ${app.name} on ${floor}?` : `Why can’t I use ${app.name} on ${floor}?`);

const DAY = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "3 days ago". */
export const daysAgo = (at: string, now = Date.now()) => {
  const days = Math.floor((now - Date.parse(at)) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

/** One change as a sentence: "Alex Kim joined", "Board was turned on". */
export const changeLine = (c: Change, names: Record<string, string>, appName: (id: string) => string) => {
  const who = c.person ? (names[c.person] ?? 'Someone') : 'Someone';
  const app = c.app ? appName(c.app) : 'An app';
  switch (c.kind) {
    case 'joined':
      return `${who} joined`;
    case 'left':
      return `${who} left`;
    case 'team-made':
      return `${c.name ?? 'A team'} was made`;
    case 'team-renamed':
      return `Renamed to ${c.name ?? 'something new'}`;
    case 'app-on':
      return `${app} was turned on`;
    case 'app-off':
      return `${app} was turned off`;
    case 'app-blocked':
      return `${app} was blocked`;
    case 'app-rule-cleared':
      return `${app} now follows the floor above`;
    case 'app-removed':
      return `${app} was removed`;
  }
};
