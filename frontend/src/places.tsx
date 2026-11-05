import { createContext, useContext, type ReactNode } from 'react';
import { place, placeRoutes, useAppContext } from '@augur/app-kit';
import type { MountContext } from '@augur/mfe-sdk';
import type { Place } from './place.js';

/**
 * What the frame shows for a place. Explorer's places share one map of the
 * org, which the frame loads once and keeps while you move about, so each
 * place's screen asks the frame to draw it rather than loading its own.
 */
export const ScreenFor = createContext<(place: Place) => ReactNode>(() => null);
const useScreen = (at: Place) => useContext(ScreenFor)(at);

function WhereScreen(): ReactNode {
  return useScreen({ view: 'where' });
}
function HereScreen(): ReactNode {
  return useScreen({ view: 'floor', id: useAppContext<MountContext>().workspace.id });
}
function FloorScreen(): ReactNode {
  return useScreen({ view: 'floor', id: places.floor.useParams().floor });
}
function AppScreen(): ReactNode {
  const { floor, app } = places.app.useParams();
  return useScreen({ view: 'app', floor, app });
}
function ReplayScreen(): ReactNode {
  return useScreen({ view: 'replay', id: places.replay.useParams().floor });
}
function BuildingScreen(): ReactNode {
  return useScreen({ view: 'building' });
}
function PlantScreen(): ReactNode {
  return useScreen({ view: 'plant' });
}

/**
 * Explorer's places on the address bar, below its route, so a place can be
 * shared and Back goes to the last one. Any other address is the map.
 */
export const places = placeRoutes(
  {
    where: place('/', WhereScreen),
    here: place('/here', HereScreen),
    building: place('/building', BuildingScreen),
    plant: place('/plant', PlantScreen),
    floor: place('/floors/:floor', FloorScreen),
    replay: place('/floors/:floor/replay', ReplayScreen),
    app: place('/floors/:floor/apps/:app', AppScreen),
  },
  { NotFound: WhereScreen },
);

/** The place on screen, as the frame needs it for its rail and for what to load. `here` is the floor they're on. */
export function usePlaceOnScreen(here: string): Place {
  const open = {
    here: places.here.useOpen(),
    building: places.building.useOpen(),
    plant: places.plant.useOpen(),
    floor: places.floor.useOpen(),
    replay: places.replay.useOpen(),
    app: places.app.useOpen(),
  };
  // Outside a place's own screen the router answers whatever the address holds.
  const params = places.app.useParams() as Partial<{ floor: string; app: string }>;
  if (open.app && params.floor && params.app) return { view: 'app', floor: params.floor, app: params.app };
  if (open.replay && params.floor) return { view: 'replay', id: params.floor };
  if (open.floor && params.floor) return { view: 'floor', id: params.floor };
  if (open.here) return { view: 'floor', id: here };
  if (open.building) return { view: 'building' };
  if (open.plant) return { view: 'plant' };
  return { view: 'where' };
}

/** Goes to a place, adding it to the history. */
export function useGoTo(): (to: Place) => void {
  const where = places.where.useGo();
  const building = places.building.useGo();
  const plant = places.plant.useGo();
  const floor = places.floor.useGo();
  const replay = places.replay.useGo();
  const app = places.app.useGo();
  return (to) => {
    switch (to.view) {
      case 'where':
        return where();
      case 'building':
        return building();
      case 'plant':
        return plant();
      case 'floor':
        return floor({ floor: to.id });
      case 'replay':
        return replay({ floor: to.id });
      case 'app':
        return app({ floor: to.floor, app: to.app });
    }
  };
}
