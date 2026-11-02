import { useCallback, useEffect, useState } from 'react';
import { Button, Facts, State, type Fact } from '@augur/app-kit';
import { usable, type AuspexApi, type MapFloor, type PersonMap } from './api.js';
import { APP_NAME, whyHere } from './words.js';

export interface GlanceProps {
  api: AuspexApi;
  here: string;
  /** Opens Explorer at a path in it. */
  onOpen: (path: string) => void;
}

/** From the org down to here. */
const climb = (map: PersonMap, here: MapFloor) => {
  const byId = new Map(map.floors.map((f) => [f.id, f]));
  const chain: MapFloor[] = [];
  for (let at: MapFloor | undefined = here; at; at = at.parentId ? byId.get(at.parentId) : undefined) chain.unshift(at);
  return chain;
};

/**
 * Explorer's card on Home, on a team's floor or the org's: the way up from
 * here to the org as a line of floor marks, why you're here, and three facts.
 * One quiet button opens the map.
 */
export function Glance({ api, here: hereId, onOpen }: GlanceProps) {
  const [map, setMap] = useState<PersonMap>();
  const [facts, setFacts] = useState<Fact[]>();
  const [failure, setFailure] = useState('');
  const load = useCallback(async () => {
    setFailure('');
    try {
      const [m, apps, changes] = await Promise.all([api.map(), api.apps(hereId), api.changes(hereId)]);
      setMap(m);
      setFacts([
        { value: m.floors.find((f) => f.id === hereId)?.people ?? 0, label: 'People here' },
        { value: apps.filter(usable).length, label: 'Apps you can use' },
        { value: changes.changes.length, label: 'Changes this week' },
      ]);
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api, hereId]);
  useEffect(() => void load(), [load]);

  if (failure) return <State kind="error" heading={`Couldn’t reach ${APP_NAME}`} body={failure} action="Try again" onAction={() => void load()} />;
  const here = map?.floors.find((f) => f.id === hereId);
  if (!map || !here || !facts) return <Facts loading count={3} />;
  const org = map.floors.find((f) => f.kind === 'org');
  const chain = climb(map, here);
  const parent = chain.length > 1 ? chain[chain.length - 2] : undefined;
  return (
    <div className="ax-glance">
      <div className="ax-climb" role="img" aria-label={`From ${chain.map((f) => f.name).join(' to ')}`}>
        {chain.map((f, i) => (
          <span key={f.id} className="ax-climb-step">
            {i ? <span className="bar" /> : null}
            <span className={`step ${f.kind === 'org' ? 'org' : 'team'} ${f.id === hereId ? 'here' : ''}`} />
          </span>
        ))}
      </div>
      <p className="ax-glance-where">
        {here.name}
        {parent ? <span className="ax-muted"> · inside {parent.name}</span> : null}
        <br />
        <span className="ax-muted">{whyHere(here, org?.name ?? 'the organisation')}.</span>
      </p>
      <Facts items={facts} />
      <div>
        <Button kind="secondary" size="sm" onPress={() => onOpen('/')}>
          Where you are
        </Button>
      </div>
    </div>
  );
}
