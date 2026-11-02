import { useCallback, useEffect, useState } from 'react';
import { Button, Heading, Icon, State } from '@augur/app-kit';
import type { AuspexApi, PersonMap } from './api.js';
import { explain, upWords, type AccessExplain, type Explained } from './access.js';

const LEVEL_WORDS = { read: 'Can read', edit: 'Can edit', manage: 'Can manage' } as const;
const dateOf = (at?: string) => (at && !Number.isNaN(Date.parse(at)) ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

export interface AccessProps {
  api: AuspexApi;
  ask: AccessExplain;
  /** The app that asked, by the name people know it by. */
  appName?: string;
  /** Back to the app that asked. */
  onDone: () => void;
}

const Row = ({ e }: { e: Explained }) => {
  const icon = e.kind === 'person' ? 'person' : e.kind === 'org' ? 'org' : 'people';
  const orb = e.kind === 'person' ? 'personal' : e.kind === 'org' ? 'org' : 'team';
  const count = e.people === undefined ? (e.kind === 'person' ? '' : 'You’re not on it, so its size isn’t shown') : `${e.people} ${e.people === 1 ? 'person' : 'people'}`;
  const line = [count, e.via, e.since ? `since ${dateOf(e.since)}` : ''].filter(Boolean).join(' · ');
  return (
    <li className="ax-who">
      <span className={`ax-orb ${orb} sm`} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="txt">
        <span className="t1">{e.who}</span>
        <span className="t2">{line}</span>
        {upWords(e) ? <span className="t2">{upWords(e)}</span> : null}
      </span>
      {e.level ? <span className="lvl">{LEVEL_WORDS[e.level]}</span> : null}
    </li>
  );
};

/**
 * Who can open one thing, asked from the app it belongs to (`access.explain`),
 * over that app: each person or team with how many people that is, how it
 * reaches them and since when; who's left out; and where a change is made and
 * whether this person may make it. Nothing on it changes anything; Esc goes back.
 */
export function Access({ api, ask, appName, onDone }: AccessProps) {
  const [map, setMap] = useState<PersonMap>();
  const [failure, setFailure] = useState('');
  const load = useCallback(async () => {
    setFailure('');
    try {
      setMap(await api.map());
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onDone]);

  const body = () => {
    if (failure) return <State kind="error" heading="Couldn’t work out who that is" body={failure} action="Try again" onAction={() => void load()} />;
    if (!map) return <State kind="loading" heading="Working out who can open it" />;
    const { entries, people, atLeast, org } = explain(ask, map);
    const summary = !org ? `Everyone at ${map.floors.find((f) => f.kind === 'org')?.name ?? 'the organisation'} can open it.` : `${atLeast ? 'At least ' : ''}${people} ${people === 1 ? 'person' : 'people'} can open it.`;
    const where = ask.change?.where;
    return (
      <>
        <Heading eyebrow="Who can open this" heading={ask.thing.title} summary={summary} level={1} />
        <ul className="ax-whos">
          {entries.map((e, i) => (
            <Row key={i} e={e} />
          ))}
          {org ? (
            <li className="ax-who out">
              <span className="ax-orb closed sm" aria-hidden="true">
                <Icon name="lock" size={18} />
              </span>
              <span className="txt">
                <span className="t1">Everyone else at {org.name}</span>
                <span className="t2">Can’t open it</span>
              </span>
            </li>
          ) : null}
        </ul>
        <div className="ax-can">
          <p className="ax-label">You can</p>
          <p>
            {where ? (
              ask.change?.allowed ? (
                <>
                  Change who can open it in <b>{where}</b>, because you manage it.
                </>
              ) : (
                <>
                  See it here. Only whoever manages it can change who can open it, in <b>{where}</b>.
                </>
              )
            ) : (
              'See it here. Nothing here changes who can open it.'
            )}
          </p>
          <div className="acts">
            <Button kind="secondary" size="sm" onPress={onDone}>
              {`Back to ${appName || 'the app'}`}
            </Button>
          </div>
        </div>
      </>
    );
  };
  return (
    <div className="ax-access ax-stage glance">
      <div className="ax-pane">{body()}</div>
    </div>
  );
}
