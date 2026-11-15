import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { cards, config, cardOf, exclusiveTalentId } from '../src/shared/catalog';
import { createBattle, defaultActions, preplannedUnable, validateActions, validateLoadouts, validateOneAction } from '../src/shared/engine';
import { alive } from '../src/shared/primitives';
import { pendingDeclarations, planningDeadline, waitingForDeclaration } from '../src/shared/declarations';
import { ResolutionService, type PlaybackSettings } from './resolution';
import { projectRoom } from '../src/shared/projection';
import type { Action, GameMode, Loadout, LobbyRoom, Player, Room, RoomView, Side } from '../src/shared/types';

export class RoomError extends Error { constructor(public code: string, message: string) { super(message); } }
export interface RoomSettings extends PlaybackSettings { turnTimerEnabled?: boolean }

export class RoomService {
  rooms = new Map<string, Room>();
  private closedRecipients = new Map<string, string[]>();
  private resolution: ResolutionService;
  constructor(private clock = () => Date.now(), private seed = () => randomBytes(4).readUInt32LE(0), private settings: RoomSettings = {}) { this.resolution = new ResolutionService(clock, settings); }
  private fail(code: string, message: string): never { throw new RoomError(code, message); }
  private get(id: string) { const room = this.rooms.get(id); if (!room) this.fail('room_missing', 'Room is closed'); return room!; }
  private membership(id: string, pid: string) { const room = this.get(id), side = room.players.findIndex(p => p.id === pid); if (side < 0) this.fail('not_member', 'You are not in this room'); return { r: room, side: side as Side }; }
  private deadline(room: Room, seconds: number) { room.phaseStarted = this.clock(); room.deadline = room.phaseStarted + seconds * 1000; room.updatedAt = this.clock(); }
  findPlayer(pid: string) { return [...this.rooms.values()].find(r => r.players.some(p => p.id === pid)); }
  list(): LobbyRoom[] { return [...this.rooms.values()].map(r => ({ id: r.id, name: r.name, mode: r.mode, players: r.players.length, phase: r.phase, host: r.players[0]?.name ?? 'Guest' })); }
  // The network layer supplies the selected mode explicitly. Duel remains the API default for older direct callers.
  create(pid: string, name: string, roomName: string, mode: GameMode = 'duel') {
    if (this.findPlayer(pid)) this.fail('already_in_room', 'Leave your current room first');
    if (this.rooms.size >= 300) this.fail('room_limit', 'Room limit reached');
    if (mode !== 'quick' && mode !== 'duel') this.fail('invalid_mode', 'Invalid room mode');
    let id = ''; do id = randomBytes(3).toString('hex').toUpperCase(); while (this.rooms.has(id));
    const now = this.clock();
    const room: Room = { mode, battleStage: 'planning', reaction: null, turnTimerEnabled: this.settings.turnTimerEnabled ?? config.timeouts.enabled, id, name: (roomName || `${name}'s room`).trim().slice(0, 24), players: [this.player(pid, name)], phase: 'waiting', picks: [[], []], draftIndex: 0, loadouts: [null, null], actions: [null, null], battle: null, deadline: 0, phaseStarted: now, createdAt: now, updatedAt: now, first: 0 };
    this.rooms.set(id, room); return room;
  }
  private player(id: string, name: string): Player { return { id, name, connected: true, ready: false, reserveMs: config.globals.pvp_reserve_pool_seconds * 1000 }; }
  join(id: string, pid: string, name: string) { const room = this.get(id); if (room.players.some(p => p.id === pid)) { this.connect(pid, true); return room; } if (this.findPlayer(pid)) this.fail('already_in_room', 'Leave your current room first'); if (room.phase !== 'waiting' || room.players.length >= 2) this.fail('room_full', 'Room is full or has already started'); room.players.push(this.player(pid, name)); room.updatedAt = this.clock(); return room; }
  leave(id: string, pid: string) {
    const { r: room, side } = this.membership(id, pid);
    if (room.phase !== 'waiting') {
      this.resolution.clear(id); room.reaction = null;
      if (room.phase !== 'finished') {
        if (room.battle) room.battle.winner = (1 - side) as Side;
        room.phase = 'finished'; room.finishedAt = this.clock(); room.deadline = 0;
      }
      room.players[side].connected = false; room.players[side].id = 'departed:' + room.players[side].id;
      if (room.players.every(p => p.id.startsWith('departed:'))) { this.rooms.delete(id); return; }
    } else {
      room.players.splice(side, 1);
      if (room.players.length === 0) { this.rooms.delete(id); return; }
      room.players[0].ready = false;
    }
    room.updatedAt = this.clock();
  }
  ready(id: string, pid: string, ready: boolean) { const { r: room, side } = this.membership(id, pid); if (room.phase !== 'waiting') this.fail('bad_phase', 'Room is not waiting for ready'); room.players[side].ready = ready; if (room.players.length === 2 && room.players.every(p => p.ready && p.connected)) { room.phase = 'draft'; room.first = (this.seed() % 2) as Side; this.deadline(room, config.globals.draft_seconds); } return room; }
  pick(id: string, pid: string, cardId: string) {
    const { r: room, side } = this.membership(id, pid); if (room.phase !== 'draft') this.fail('bad_phase', 'Card draft has not started'); const current = (room.draftIndex === 0 || room.draftIndex === 3 ? room.first : 1 - room.first) as Side; if (side !== current) this.fail('not_your_pick', 'Wait for the other player to pick'); if (!cards.some(c => c.id === cardId) || room.picks.flat().includes(cardId)) this.fail('invalid_pick', 'Card cannot be selected'); room.picks[side].push(cardId); room.draftIndex++;
    if (room.draftIndex === 4) { if (room.mode === 'quick') { const quickLoadouts: [Loadout[], Loadout[]] = [0, 1].map(s => room.picks[s].map(selectedCardId => { const card=cardOf(selectedCardId);return { cardId: selectedCardId, skills: card.skills.map(skill => skill.id), talent: exclusiveTalentId(card)??0 }; })) as [Loadout[], Loadout[]]; room.loadouts = quickLoadouts; room.battle = createBattle(quickLoadouts, this.seed()); room.phase = 'battle'; this.planningDeadline(room); } else { room.phase = 'setup'; this.deadline(room, config.globals.setup_seconds); } } else this.deadline(room, config.globals.draft_seconds); return room;
  }
  setup(id: string, pid: string, loadouts: Loadout[]) { const { r: room, side } = this.membership(id, pid); if (room.phase !== 'setup') this.fail('bad_phase', 'Room is not in setup phase'); if (room.loadouts[side]) this.fail('already_submitted', 'Setup is already locked'); const normalized = room.mode === 'quick' ? loadouts.map(l => {const card=cardOf(l.cardId);return { cardId: l.cardId, skills: card.skills.map(s => s.id), talent: exclusiveTalentId(card)??0 };}) : loadouts; validateLoadouts(normalized, room.picks[side], room.mode); room.loadouts[side] = structuredClone(normalized); if (room.loadouts.every(Boolean)) { room.battle = createBattle(room.loadouts as [Loadout[], Loadout[]], this.seed()); room.phase = 'battle'; this.planningDeadline(room); } return room; }
  declare(id: string, pid: string, action: Action) { const { r: room, side } = this.membership(id, pid); if (room.phase !== 'battle' || room.battleStage !== 'planning' || !room.battle || !room.declarations) this.fail('bad_phase', 'No declaration is required now'); const unit = pendingDeclarations(room, side).find(u => u.id === action?.actor); if (!unit) this.fail('invalid_declaration', 'Only your undeclared characters can declare'); validateOneAction(room.battle, unit, action); room.declarations.actions.push(structuredClone(action)); if (!unit.revealed.includes(action.skill)) unit.revealed.push(action.skill); unit.statuses.find(s => s.id === 'declaration')!.data = { skill: action.skill, round: room.battle.round }; if (!pendingDeclarations(room, side).length && room.turnTimerEnabled) { const other = (1 - side) as Side; room.declarations.deadlines[other] = Math.max(room.declarations.deadlines[other], this.clock()) + config.globals.declaration_response_seconds * 1000; } room.updatedAt = this.clock(); return room; }
  act(id: string, pid: string, actions: Action[]) {
    const { r: room, side } = this.membership(id, pid); if (room.phase !== 'battle' || room.battleStage !== 'planning' || !room.battle) this.fail('bad_phase', 'Room is not accepting actions'); if (room.actions[side]) this.fail('already_submitted', 'Actions are already locked'); if (pendingDeclarations(room, side).length) this.fail('declaration_required', '请先完成行动声明'); if (pendingDeclarations(room, (1 - side) as Side).length) this.fail('awaiting_declaration', '等待对方声明后再提交行动'); validateActions(room.battle, side, actions); for (const locked of room.declarations?.actions ?? []) if (room.battle.units.find(u => u.id === locked.actor)!.side === side && !isDeepStrictEqual(actions.find(a => a.actor === locked.actor), locked)) this.fail('declaration_locked', '已声明的行动不能修改'); const now = this.clock(); if (room.turnTimerEnabled) room.players[side].reserveMs = Math.max(0, room.players[side].reserveMs - Math.max(0, now - planningDeadline(room, side))); room.actions[side] = structuredClone(actions); if (room.actions.every(Boolean)) this.settle(room); return room;
  }
  private planningDeadline(room: Room) { room.battleStage = 'planning'; room.reaction = null; delete room.declarations; for (const unit of room.battle?.units ?? []) for (const status of unit.statuses) if (status.id === 'declaration') delete status.data; if (room.turnTimerEnabled) this.deadline(room, config.globals.pvp_turn_time_seconds); else { room.deadline = 0; room.phaseStarted = this.clock(); room.updatedAt = this.clock(); } if (room.battle?.units.some(unit => alive(unit) && !preplannedUnable(unit, room.battle!.round) && unit.statuses.some(status => status.id === 'declaration'))) room.declarations = { actions: [], deadlines: [room.deadline, room.deadline] }; }
  timer(id: string, pid: string, enabled: boolean) { const { r: room, side } = this.membership(id, pid); if (side !== 0 || room.phase !== 'waiting') this.fail('settings_locked', 'Only the host can change the timer before starting'); if (typeof enabled !== 'boolean') this.fail('invalid_setting', 'Invalid timer setting'); room.turnTimerEnabled = enabled; room.players.forEach(p => p.ready = false); room.updatedAt = this.clock(); return room; }
  connect(pid: string, connected: boolean) { const room = this.findPlayer(pid); if (!room) return; const player = room.players.find(p => p.id === pid)!; player.connected = connected; if (!connected) (player as Player & { disconnectedAt: number }).disconnectedAt = this.clock(); else delete (player as Player & { disconnectedAt?: number }).disconnectedAt; return room; }
  view(id: string, pid: string): RoomView { const { r: room, side } = this.membership(id, pid); return projectRoom(room, side, this.clock()); }
  consumeClosed(id: string) { const players = this.closedRecipients.get(id) ?? []; this.closedRecipients.delete(id); return players; }
  private settle(room: Room) { try { this.resolution.start(room); } catch (error) { room.actions = [null, null]; throw error; } }
  playbackReady(id: string, pid: string, playbackId: string) { const { r: room, side } = this.membership(id, pid); this.resolution.ready(room, side, playbackId); return room; }
  respond(id: string, pid: string, reactionId: string, decision: boolean|Action) { const { r: room, side } = this.membership(id, pid), prompt = room.reaction; if (room.phase !== 'battle' || room.battleStage !== 'reaction' || !prompt || prompt.id !== reactionId) this.fail('stale_reaction', 'Reaction window has expired'); if (prompt.side !== side) this.fail('not_your_reaction', 'Wait for the other player reaction'); if (this.clock() >= prompt.deadline) this.fail('reaction_expired', 'Reaction window has expired'); this.resolution.respond(room, reactionId, decision); return room; }
  surrender(id: string, pid: string) { const { r: room, side } = this.membership(id, pid); if (!room.battle || room.phase !== 'battle') this.fail('bad_phase', 'Cannot surrender now'); this.resolution.clear(id); room.reaction = null; room.battle.winner = (1 - side) as Side; room.phase = 'finished'; room.finishedAt = this.clock(); room.deadline = 0; return room; }
  rematch(id: string, pid: string) { const { r: room } = this.membership(id, pid); if (room.phase !== 'finished') this.fail('bad_phase', 'Finish the current battle first'); if (room.players.length !== 2 || room.players.some(p => p.id.startsWith('departed:'))) this.fail('need_opponent', 'The opponent has left; create a new room'); this.resolution.clear(id); room.reaction = null; room.battleStage = 'planning'; room.phase = 'waiting'; room.players.forEach(p => { p.ready = false; p.reserveMs = config.globals.pvp_reserve_pool_seconds * 1000; }); room.picks = [[], []]; room.loadouts = [null, null]; room.actions = [null, null]; room.battle = null; room.draftIndex = 0; room.deadline = 0; room.finishedAt = undefined; room.updatedAt = this.clock(); return room; }
  tick() {
    const changed: string[] = [], now = this.clock();
    for (const room of this.rooms.values()) {
      if (room.phase !== 'finished' && room.players.every(p => !p.connected) && now - room.updatedAt > config.globals.room_ttl_seconds * 1000) { this.resolution.clear(room.id); this.rooms.delete(room.id); changed.push(room.id); continue; }
      if (room.phase === 'finished') { if (room.finishedAt !== undefined && now - room.finishedAt >= config.globals.finished_room_seconds * 1000) { this.resolution.clear(room.id); this.closedRecipients.set(room.id, room.players.filter(p => !p.id.startsWith('departed:')).map(p => p.id)); this.rooms.delete(room.id); changed.push(room.id); } continue; }
      if (room.phase === 'waiting') continue;
      const missing = room.players.findIndex(p => !p.connected && now - ((p as Player & { disconnectedAt: number }).disconnectedAt ?? now) > config.globals.reconnect_seconds * 1000);
      if (missing >= 0) { this.resolution.clear(room.id); room.reaction = null; if (room.battle) room.battle.winner = (1 - missing) as Side; room.phase = 'finished'; room.finishedAt = now; room.deadline = 0; changed.push(room.id); continue; }
      if (room.phase === 'draft' && now >= room.deadline) { const side = (room.draftIndex === 0 || room.draftIndex === 3 ? room.first : 1 - room.first) as Side; this.pick(room.id, room.players[side].id, cards.find(c => !room.picks.flat().includes(c.id))!.id); changed.push(room.id); }
      else if (room.phase === 'setup' && now >= room.deadline) { for (const side of [0, 1] as Side[]) if (!room.loadouts[side]) this.setup(room.id, room.players[side].id, room.picks[side].map(id => {const card=cardOf(id);return ({ cardId: id, skills: room.mode === 'quick' ? card.skills.map(s => s.id) : card.skills.slice(0, 4).map(s => s.id), talent: room.mode === 'quick' ? exclusiveTalentId(card)??0 : exclusiveTalentId(card)??5 });})); changed.push(room.id); }
      else if (room.phase === 'battle' && room.battleStage !== 'planning') { const result = this.resolution.advance(room, now); if (result) { changed.push(room.id); if (result === 'complete') { if (room.battle!.winner !== null) { room.phase = 'finished'; room.finishedAt = now; room.deadline = 0; } else this.planningDeadline(room); } } }
      else if (room.phase === 'battle' && room.turnTimerEnabled) for (const side of [0, 1] as Side[]) if (!room.actions[side] && !waitingForDeclaration(room, side) && now >= planningDeadline(room, side) + room.players[side].reserveMs) { const actions = defaultActions(room.battle!, side).map(a => room.declarations?.actions.find(locked => locked.actor === a.actor) ?? a); for (const unit of pendingDeclarations(room, side)) this.declare(room.id, room.players[side].id, actions.find(a => a.actor === unit.id)!); if (!pendingDeclarations(room, (1 - side) as Side).length) this.act(room.id, room.players[side].id, actions); changed.push(room.id); if (room.phase !== 'battle' || room.battleStage !== 'planning') break; }
    }
    return [...new Set(changed)];
  }
}
