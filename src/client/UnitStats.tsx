import {stages,statNames} from '../shared/catalog';
import {pointValue,stageValue} from '../shared/primitives';
import type {PublicUnit,Stat} from '../shared/types';
import './unit-stats.css';

const stats:Stat[]=['atk','sp_atk','dfs','sp_dfs','spd'];
export function UnitStats({unit}:{unit:PublicUnit}){
 return <div className="unit-stat-section">
  <div className="unit-stat-label">基础数值</div>
  <div className="unit-stats">{stats.map(stat=><span key={stat} data-stat={stat}>{statNames[stat]} {Math.floor(pointValue(unit,stat))}</span>)}</div>
  <div className="unit-stat-label">属性等级</div>
  <div className="unit-stages">{stages.map(stat=>{const value=stageValue(unit,stat);return <span key={stat} data-stage={stat} className={value>0?'positive':value<0?'negative':'neutral'}>{statNames[stat]} <b>{value>0?'+':''}{value}</b></span>;})}</div>
 </div>;
}
