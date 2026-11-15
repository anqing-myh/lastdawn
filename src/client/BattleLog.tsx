import {useState} from 'react';
import {cardOf,statNames} from '../shared/catalog';
import {damageHighlights} from '../shared/combat-presentation';
import {groupBattleEvents,logSourceName,type LogGroup} from '../shared/battle-log';
import type {DamageRecord,Event,RoomView,Settlement} from '../shared/types';
import './battle-log.css';

function Effect({event:e,index,room:r,hit}:{event:Event;index:number;room:RoomView;hit?:number}){
 const actor=r.units.find(u=>u.id===e.actor),target=r.units.find(u=>u.id===e.target),d=e.detail;
 return <li data-event-index={index} className={'log-event log-'+e.kind+(d?.crit&&!d.missed?' critical-event':'')+(d&&!d.missed&&d.channel!=='fixed'&&d.typeMultiplier>1?' advantage-event':'')+(d&&!d.missed&&d.channel!=='fixed'&&d.typeMultiplier<1?' resisted-event':'')}>
  {(actor||target)&&<div className="event-participants">{actor&&<small className={actor.side===r.side?'friendly':'hostile'}>{actor.side===r.side?'我方 ':'对方 '}{cardOf(actor.cardId).name}</small>}{actor&&target&&<span>→</span>}{target&&<small className={target.side===r.side?'friendly':'hostile'}>{actor?'目标：':'承受者：'}{target.side===r.side?'我方 ':'对方 '}{cardOf(target.cardId).name}</small>}</div>}
  {hit!==undefined&&<small className="log-hit-number">第 {hit} 段攻击</small>}<div className="hit-badges">{damageHighlights(d).map(b=><strong key={b.tone} className={'hit-badge hit-'+b.tone}>{b.label}</strong>)}</div><p>{e.text}</p>
  {d&&<DamageDetails detail={d}/>}
 </li>;
}
function SkillLog({group:g,room:r}:{group:LogGroup;room:RoomView}){
 const [collapsed,setCollapsed]=useState(false),action=g.action?.event,actor=r.units.find(u=>u.id===action?.actor),isCollapsed=g.complete&&collapsed;
 const effects=g.recipients.flatMap(x=>x.effects),damage=effects.filter(x=>x.event.detail).reduce((n,x)=>n+x.event.detail!.hpLost,0);
 return <article className={'skill-log-group '+(g.complete?'is-complete':'is-resolving')} data-action-id={g.id}>
  <button className="skill-log-heading" aria-expanded={!isCollapsed} disabled={!g.complete} onClick={()=>setCollapsed(!collapsed)}>
   <span className="skill-log-title"><strong>{action?.skillName??logSourceName(action?.skill)??(g.id.startsWith('effect:')?'战场效果':'行动结果')}</strong><small>{actor?(actor.side===r.side?'我方 ':'对方 ')+cardOf(actor.cardId).name:g.parentId?'追加结算':'战场记录'}{g.parentId&&actor?' · 追加行动':''}</small></span>
   <span className="skill-log-state">{g.complete?(isCollapsed?'展开 ▸':'收起 ▾'):(r.battleStage==='reaction'?'等待响应':'结算中…')}</span>
  </button>
  <div className="skill-log-overview">{effects.length} 项效果{damage>0?' · 造成伤害 '+damage:''}{g.complete?' · 已结算':''}</div>
  {!isCollapsed&&<div className="skill-log-targets">{g.recipients.map(recipient=>{const unit=r.units.find(u=>u.id===recipient.id),hits=recipient.effects.filter(x=>x.event.detail).length;return <section className="skill-log-target" data-recipient={recipient.id} key={recipient.id}><h4 className={unit?(unit.side===r.side?'friendly':'hostile'):''}>{unit?(unit.side===r.side?'我方 ':'对方 ')+cardOf(unit.cardId).name:'战场'}<small>{hits>0?hits+' 段伤害':recipient.effects.length+' 项效果'}</small></h4><ol className="skill-log-effects">{recipient.effects.map(({event,index})=><Effect key={index} event={event} index={index} room={r} hit={event.detail?recipient.effects.filter(x=>x.event.detail&&x.index<=index).length:undefined}/>)}</ol></section>;})}{!effects.length&&<p className="skill-log-empty">{g.complete?'本次行动已结束。':'等待结算效果…'}</p>}</div>}
 </article>;
}
export function BattleLogGroups({record,room}:{record:Settlement;room:RoomView}){
 const settled=record.round===0||record.round<room.round||room.phase==='finished'||room.battleStage==='planning';
 return <>{groupBattleEvents(record,settled).map(group=><SkillLog key={record.round+':'+group.id} group={group} room={room}/>)}</>;
}
export function PlaybackControls({speed,onChange}:{speed:1|2;onChange:(speed:1|2)=>void}){
 return <div className="playback-controls"><span>播放速度</span><div className="playback-switch" role="group" aria-label="播放速度">{([1,2] as const).map(value=><button key={value} aria-pressed={speed===value} onClick={()=>onChange(value)}>{value}倍速</button>)}</div><small>仅影响你的效果显示 · 可随时切换</small></div>;
}

function DamageDetails({detail:d}:{detail:DamageRecord}){return <details><summary>伤害明细 ↗</summary><dl><dt>威力 / 防御维度</dt><dd>{Math.floor(d.power)} / {statNames[d.defenseBasis]??d.defenseBasis}</dd><dt>攻击基础 / 点数 / 等级</dt><dd>{d.attackBreakdown?d.attackBreakdown.base+' / '+Math.floor(d.attackBreakdown.points)+' / '+d.attackBreakdown.stage:'—'}</dd><dt>防御基础 / 点数 / 等级</dt><dd>{d.defenseBreakdown?d.defenseBreakdown.base+' / '+d.defenseBreakdown.points+' / '+d.defenseBreakdown.stage:'—'}</dd>{d.channel!=='fixed'&&<><dt>无视防御点数 / 本次有效防御</dt><dd>{d.defensePenetration??0} / {Number(d.defense.toFixed(3))}</dd></>}<dt>克制因子</dt><dd>{d.channel==='fixed'?'固定伤害不应用系别倍率':d.typeFactors.join(' × ')+' = '+d.typeRaw.toFixed(3)+(d.clamped?' → '+d.typeMultiplier+'（截断）':'')}</dd><dt>暴击率 / 暴击</dt><dd>{(d.critRate*100).toFixed(1)}% / {d.missed?'未生效':d.crit?'是':'否'}</dd>{d.crit&&!d.missed&&<><dt>暴击次数 / 总暴击倍率</dt><dd>{d.critCount??1}次 / ×{Number((d.critMultiplier??1).toFixed(4))}</dd></>}{d.multiplierBreakdown&&d.multiplierBreakdown.length>0&&<><dt>特殊伤害倍率</dt><dd><ul className="damage-multiplier-list">{d.multiplierBreakdown.map((m,i)=><li key={i}>{m.label} ×{m.value}</li>)}</ul></dd></>}<dt>特殊效果前伤害</dt><dd>{d.preSpecialDamage??d.rawDamage}</dd>{d.specialEffects&&d.specialEffects.length>0&&<><dt>特殊效果修正</dt><dd><ul className="damage-multiplier-list">{d.specialEffects.map((m,i)=><li key={i}>{m.label}：{m.before} → {m.after}</li>)}</ul></dd></>}<dt>特殊效果后伤害</dt><dd>{d.calculatedDamage??d.damageAmount??d.rawDamage}</dd><dt>最终造成伤害</dt><dd>{d.damageAmount??d.rawDamage}</dd><dt>固伤</dt><dd>{d.fixedDamage}</dd><dt>护盾吸收 / 溢出抵消</dt><dd>{d.shieldAbsorbed} / {d.overflowNullified}</dd><dt>实际扣除生命</dt><dd>{d.hpLost}</dd></dl></details>;}

