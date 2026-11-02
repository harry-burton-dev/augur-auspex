/**
 * Where Explorer is: your map, one floor, the answer about one app on one floor,
 * a floor's last 30 days (its leads and admins), or the plant room (admins).
 */
export type Place = { view: 'where' } | { view: 'floor'; id: string } | { view: 'app'; floor: string; app: string } | { view: 'replay'; id: string } | { view: 'plant' } | { view: 'building' };

/** Explorer's own address for a place, below its route. */
export const pathFor = (place: Place): string => {
  switch (place.view) {
    case 'where':
      return '/';
    case 'plant':
      return '/plant';
    case 'building':
      return '/building';
    case 'floor':
      return `/floors/${encodeURIComponent(place.id)}`;
    case 'replay':
      return `/floors/${encodeURIComponent(place.id)}/replay`;
    case 'app':
      return `/floors/${encodeURIComponent(place.floor)}/apps/${encodeURIComponent(place.app)}`;
  }
};

/** The place an address names; `/here` is the floor they're on. Anything else is the map. */
export const placeFor = (path: string, here: string): Place => {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'here') return { view: 'floor', id: here };
  if (parts[0] === 'plant') return { view: 'plant' };
  if (parts[0] === 'building') return { view: 'building' };
  if (parts[0] === 'floors' && parts[1] && parts[2] === 'replay') return { view: 'replay', id: parts[1] };
  if (parts[0] === 'floors' && parts[1] && parts[2] === 'apps' && parts[3]) return { view: 'app', floor: parts[1], app: parts[3] };
  if (parts[0] === 'floors' && parts[1]) return { view: 'floor', id: parts[1] };
  return { view: 'where' };
};
