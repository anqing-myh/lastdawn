import {useEffect,useRef,useState} from 'react';
import {BattlePlayback} from './playback';
import type {LobbyRoom,RoomView,ServerMessage} from '../shared/types';
export function useConnection(){
 const [status,setStatus]=useState<'connecting'|'online'|'offline'>('connecting');const [session,setSession]=useState<{playerId:string;name:string}|null>(null);const [room,setRoom]=useState<RoomView|null>(null);const [rooms,setRooms]=useState<LobbyRoom[]>([]);const [online,setOnline]=useState(0);const [error,setError]=useState('');const [offset,setOffset]=useState(0);const socket=useRef<WebSocket|null>(null);const pending=useRef<string>('');const reconnect=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [playbackSpeed,setSpeed]=useState<1|2>(()=>sessionStorage.getItem('dawn_playback_speed')==='1'?1:2);
 const playback=useRef<BattlePlayback|null>(null);
 if(!playback.current){playback.current=new BattlePlayback(setRoom,id=>{const ws=socket.current;if(ws?.readyState!==WebSocket.OPEN)return false;ws.send(JSON.stringify({type:'playback-ready',playbackId:id}));return true;});playback.current.setSpeed(playbackSpeed,Date.now());}
 function setPlaybackSpeed(speed:1|2){sessionStorage.setItem('dawn_playback_speed',String(speed));playback.current!.setSpeed(speed,Date.now());setSpeed(speed);}
 useEffect(()=>{const timer=setInterval(()=>playback.current!.tick(Date.now()),50);return()=>clearInterval(timer);},[]);
 useEffect(()=>{let stopped=false,attempt=0;function connect(){if(stopped)return;setStatus('connecting');const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');socket.current=ws;
 ws.onopen=()=>{attempt=0;ws.send(JSON.stringify({type:'hello',token:sessionStorage.getItem('dawn_token'),name:localStorage.getItem('dawn_name')??''}));};
 ws.onmessage=e=>{const m=JSON.parse(e.data) as ServerMessage;switch(m.type){case 'session':sessionStorage.setItem('dawn_token',m.token);localStorage.setItem('dawn_name',m.name);setSession(m);setStatus('online');break;case 'lobby':setRooms(m.rooms);setOnline(m.online);break;case 'room':playback.current!.receive(m.room,Date.now());setOffset(m.room.serverTime-Date.now());pending.current='';break;case 'left':playback.current!.receive(null,Date.now());break;case 'room-closed':playback.current!.receive(null,Date.now());setError('本局已结束，房间已关闭');break;case 'error':setError(m.message);pending.current='';break;case 'pong':break;}};
 ws.onerror=()=>{};ws.onclose=e=>{if(stopped)return;if(e.code===4001){setStatus('offline');setError('此游客会话已在其他页面连接。请关闭重复页面后刷新。');return;}setStatus('offline');reconnect.current=setTimeout(connect,Math.min(8000,1000*Math.pow(1.5,attempt++)));};}
 connect();const heartbeat=setInterval(()=>{if(socket.current?.readyState===WebSocket.OPEN)socket.current.send(JSON.stringify({type:'ping'}));},20000);return()=>{stopped=true;if(reconnect.current)clearTimeout(reconnect.current);clearInterval(heartbeat);socket.current?.close();};},[]);
 function send(type:string,data:Record<string,unknown>={}){if(socket.current?.readyState!==WebSocket.OPEN){setError('连接恢复中，请稍候');return;}socket.current.send(JSON.stringify({type,...data}));}
 return {status,session,room,rooms,online,error,setError,send,offset,playbackSpeed,setPlaybackSpeed};
}

