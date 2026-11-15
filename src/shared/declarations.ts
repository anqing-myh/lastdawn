import {alive} from './primitives';
import {preplannedUnable} from './engine';
import type {Room,Side} from './types';

export function pendingDeclarations(r:Room,side:Side){
 return r.battle?.units.filter(u=>u.side===side&&alive(u)&&!preplannedUnable(u,r.battle!.round)&&u.statuses.some(s=>s.id==='declaration')&&!r.declarations?.actions.some(a=>a.actor===u.id))??[];
}
export function planningDeadline(r:Room,side:Side){return r.declarations?.deadlines[side]??r.deadline;}
// Waiting for the opponent's announcement must not consume decision time.
// If both sides must announce, each keeps its own announcement clock running.
export function waitingForDeclaration(r:Room,side:Side){return pendingDeclarations(r,side).length===0&&pendingDeclarations(r,(1-side) as Side).length>0;}
