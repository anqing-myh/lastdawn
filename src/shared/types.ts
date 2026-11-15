export type Side = 0 | 1;
export type GameMode = 'quick'|'duel';
export type Stat = 'hp'|'atk'|'dfs'|'sp_atk'|'sp_dfs'|'spd';
export type Stage = Exclude<Stat,'hp'>|'crit';
export type Stats = Record<Stat,number>;
export type Channel = 'physical'|'spell'|'mixed'|'fixed';
export interface Skill { id:string; index:number; name:string; elements:string[]; timing:'first'|'normal'|'last'|'passive'; kind:'attack'|'support'; channel:Channel; power:number|null; pp:number|null; target:string; description:string; source_power:string; notes:string }
export interface Card { id:string; number:number; name:string; elements:string[]; stats:Stats; forms:Stats[]; is_dragon:boolean; skills:Skill[]; notes:string; background?:string }
export interface Talent { id:number; name:string; description:string; exclusive:boolean; available:boolean }
export interface Loadout { cardId:string; skills:string[]; talent:number; allocation?:Partial<Stats> }
export interface Action { actor:string; skill:string; target?:string; targetFragment?:number; option?:string; element?:string; attribute?:Stage; allocation?:Partial<Record<Stage,number>>; boostAllocation?:Partial<Record<Stage,number>>; copySkill?:string; replacement?:string; replaceFrom?:string; replaceTo?:string; resetSpeed?:boolean; extra?:Action[] }
export interface Modifier { stat:Stat; delta:number; until:number|null; source:string }
export interface StageModifier { stat:Stage; delta:number; until:number|null; source:string }
export interface Status { id:string; source:string; until:number|null; debuff:boolean; value:number; data?:Record<string,unknown> }
export interface Shield { id:string; type:'physical'|'spell'; value:number; linked?:string; breakStage?:boolean }
export interface Unit { id:string; cardId:string; side:Side; slot:number; hp:number; base:Stats; stages:Record<Stage,number>; stageModifiers:StageModifier[]; modifiers:Modifier[]; elements:string[]; elementUntil:number|null; form:number; skills:string[]; pp:Record<string,number>; talent:number; talentRevealed:boolean; revealed:string[]; statuses:Status[]; shields:Shield[]; counters:Record<string,number>; charged:boolean; chargeUntil:number; lastSkill:string|null; lastWasAttack:boolean; attackedThisRound:boolean; damagedThisRound:number; damageThisRound:number; aliveRounds:number; history:number[]; copied:string[]; disabled:string[]; dead:boolean; split:number; fragments?:number[]; fragmentMax?:number; allocation:Partial<Stats> }
export interface DamageSpecialEffect { label:string; before:number; after:number; kind:'add'|'multiply'|'cap'|'floor'|'other' }
export interface DamageRecord { target:string; channel:Channel; attack:number; defense:number; defenseBasis:string; power:number; crit:boolean; critRate:number; critCount?:number; critMultiplier?:number; defensePenetration?:number; typeFactors:number[]; typeRaw:number; typeMultiplier:number; clamped:boolean; rawDamage:number; preSpecialDamage?:number; calculatedDamage?:number; damageAmount?:number; shieldAbsorbed:number; overflowNullified:number; fixedDamage:number; hpLost:number; isAttack:boolean; missed:boolean; multiplierBreakdown?:{label:string;value:number}[]; specialEffects?:DamageSpecialEffect[]; attackBreakdown?:{base:number;points:number;stage:number}; defenseBreakdown?:{base:number;points:number;stage:number}; targetFragment?:number }
export interface Event { kind:'action'|'damage'|'heal'|'status'|'stage'|'point'|'talent'|'passive'|'notice'|'death'|'revive'|'shield'; actor?:string; target?:string; skill?:string; skillName?:string; text:string; value?:number; detail?:DamageRecord; privateSide?:Side; actionId?:string; parentActionId?:string }
export interface Settlement { round:number; events:Event[]; order:{actor:string;skill:string;speed:number;priority:number}[]; completedActions?:string[] }
export interface Battle { round:number; units:Unit[]; seed:number; winner:Side|'draw'|null; records:Settlement[]; global:Record<string,number>; endedRound:boolean; plannedActions?:Action[]; mentalMarks?:{owner:string;target:string;round:number;skills:string[]}[] }
export interface Player { id:string; name:string; connected:boolean; ready:boolean; reserveMs:number }
export type Phase = 'waiting'|'draft'|'setup'|'battle'|'finished';
export type BattleStage = 'planning'|'resolving'|'reaction';
export interface SacrificeRequest { id:string; kind:'sacrifice'; side:Side; actor:string; attacker:string; target:string; skill:string; incomingDamage:number; sacrificeCost:number; allyDamage:number; }
export interface ExtraActionRequest { id:string; kind:'extra-action'; side:Side; actor:string; skill:string; restriction:'any'|'attack'|'support'; allowedSkills:string[]; defaultAction:Action; }
export type ReactionRequest = SacrificeRequest|ExtraActionRequest;
export type ReactionDecision = boolean|Action;
export type ReactionPrompt = ReactionRequest & { deadline:number };
export interface ResolutionPlayback { id:string; initial:Battle; frames:{battle:Battle;durationMs:number}[]; ready:Side[] }
export interface PlaybackSnapshot { units:PublicUnit[]; record:Settlement; round:number; winner:Side|'draw'|null }
export interface PlaybackFrame { units:PublicUnit[]; events:Event[]; completedActions:string[]; order:Settlement['order']; durationMs:number }
export interface PublicPlayback { id:string; initial:PlaybackSnapshot; frames:PlaybackFrame[]; ready:Side[]; finished?:boolean }
export interface DeclarationPlanning { actions:Action[]; deadlines:[number,number] }
export interface DeclarationView { pending:string[]; locked:{actor:string;skill:string;action?:Action}[]; waiting:boolean; deadline:number }
export interface Room { declarations?:DeclarationPlanning; playback?:ResolutionPlayback; mode:GameMode; battleStage:BattleStage; reaction:ReactionPrompt|null; turnTimerEnabled:boolean; id:string; name:string; players:Player[]; phase:Phase; picks:[string[],string[]]; draftIndex:number; loadouts:[Loadout[]|null,Loadout[]|null]; actions:[Action[]|null,Action[]|null]; battle:Battle|null; deadline:number; phaseStarted:number; createdAt:number; updatedAt:number; finishedAt?:number; first:Side }
export interface PublicUnit extends Omit<Unit,'skills'|'talent'|'pp'|'allocation'|'copied'|'disabled'|'statuses'|'modifiers'|'stageModifiers'|'counters'> { skills:string[]; talent:number|null; pp:Record<string,number>; allocation?:Partial<Stats>; copied:string[]; disabled:string[]; statuses:Status[]; modifiers:Modifier[]; stageModifiers:StageModifier[]; counters:Record<string,number>; effective:Stats; maxHp:number; preplannedUnable?:boolean; skillRestrictions?:Record<string,string>; targetRestrictions?:Record<string,string>; actionHints?:string[] }
export interface RoomView { declarations?:DeclarationView; playback?:PublicPlayback; mode:GameMode; battleStage:BattleStage; reaction:ReactionPrompt|null; turnTimerEnabled:boolean; id:string; name:string; players:Player[]; phase:Phase; side:Side; picks:[string[],string[]]; draftSide:Side|null; draftRemaining:number; setupSubmitted:boolean[]; submitted:boolean[]; units:PublicUnit[]; round:number; winner:Side|'draw'|null; records:Settlement[]; deadline:number; phaseStarted:number; serverTime:number }
export interface LobbyRoom { id:string;name:string;mode:GameMode;players:number;phase:Phase;host:string }
export interface SessionMessage { type:'session';token:string;playerId:string;name:string }
export type ServerMessage=SessionMessage|{type:'lobby';rooms:LobbyRoom[];online:number}|{type:'room';room:RoomView}|{type:'error';message:string;code:string}|{type:'left'}|{type:'room-closed';roomId:string}|{type:'pong';time:number};

