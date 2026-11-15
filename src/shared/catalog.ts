import rawCards from '../data/cards.json';
import rawTalents from '../data/talents.json';
import rawConfig from '../data/config.json';
import type {Card,Skill,Talent,Stage} from './types';
// The archive and draft both use the canonical card number order.  Runtime
// lookups use the maps below, so sorting here does not change card IDs.
export const cards=[...(rawCards as Card[])].sort((a,b)=>a.number-b.number);
export const talents=rawTalents as Talent[];
export const config=rawConfig;
export const stages:Stage[]=['atk','dfs','sp_atk','sp_dfs','spd','crit'];
export const statNames:Record<string,string>={hp:'生命',atk:'物攻',dfs:'物防',sp_atk:'魔攻',sp_dfs:'魔抗',spd:'速度',crit:'暴击'};
export const elementNames=['水','火','土','风','草','雷','灵','战斗'];
export const cardMap=new Map(cards.map(c=>[c.id,c]));
export const tackle:Skill={id:'tackle',index:0,name:'撞击',elements:['战斗'],timing:'normal',kind:'attack',channel:'physical',power:60,pp:-1,target:'single',description:'基础攻击，物理威力 60，PP 无限。',source_power:'60 atk',notes:''};
export const charge:Skill={...tackle,id:'charge',name:'蓄力',kind:'support',power:0,target:'self',description:'本回合蓄力，下回合攻击威力 ×1.5。连续蓄力不叠加。'};
export const skillMap=new Map([...cards.flatMap(c=>c.skills),tackle,charge].map(s=>[s.id,s]));
export function cardOf(id:string):Card {const c=cardMap.get(id);if(!c)throw Error('未知卡牌 '+id);return c;}
export function skillOf(id:string):Skill {const s=skillMap.get(id);if(!s)throw Error('未知技能 '+id);return s;}
export function talentOf(id:number){return talents.find(t=>t.id===id);}
export function exclusiveTalentId(card:Card|{number:number}){return card.number===22?15:card.number===34?16:null;}
export function validateCatalog(){
 if(cards.length!==34)throw Error('卡池数量错误');
 if(new Set(cards.map(c=>c.id)).size!==cards.length)throw Error('重复卡牌 ID');
 for(const c of cards){if(c.skills.length!==6||Object.entries(c.stats).some(([k,v])=>!Number.isInteger(v)||v<(k==='atk'?0:1)))throw Error('卡牌数据错误 '+c.id);for(const s of c.skills)if(s.pp===null)throw Error('未裁决 PP '+s.id);}
 const matrix=config.types.matrix as Record<string,Record<string,number>>;
 for(const e of elementNames)for(const d of elementNames)if(![.6,1,1.6].includes(matrix[e]?.[d]))throw Error('克制矩阵不完整');
 const counts=elementNames.flatMap(e=>elementNames.map(d=>matrix[e][d]));
 if(counts.filter(v=>v===1.6).length!==22||counts.filter(v=>v===.6).length!==18)throw Error('克制矩阵统计错误');
 const expected:Record<string,number>={'水':-1,'土':-1,'风':0,'草':0,'火':1,'雷':1,'灵':2,'战斗':2};
 for(const e of elementNames){const delta=(vs:number[])=>vs.filter(v=>v===1.6).length-vs.filter(v=>v===.6).length;if(delta(elementNames.map(d=>matrix[e][d]))!==expected[e]||delta(elementNames.map(a=>matrix[a][e]))!==expected[e])throw Error('克制矩阵行列规则错误 '+e);}
}
validateCatalog();


