import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {RoomService,RoomError} from './rooms';
import type {Action,Loadout,ServerMessage} from '../src/shared/types';
const production=process.argv.includes('--production');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port=Number(process.env.PORT??3000),host=process.env.HOST??'0.0.0.0';
const timerEnv=process.env.TURN_TIMER_ENABLED;
const rooms=new RoomService(undefined,undefined,{turnTimerEnabled:timerEnv===undefined?undefined:timerEnv==='true'});
type Session={token:string;id:string;name:string;ws:WebSocket|null;lastSeen:number;requests:number;window:number;alive:boolean};
const sessions=new Map<string,Session>();
const server=http.createServer();
if(!production){const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'spa'});server.on('request',(req,res)=>{if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.rooms.size}));return;}vite.middlewares(req,res);});}
else server.on('request',(req,res)=>{
 if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.rooms.size}));return;}
 let decoded:string;try{decoded=decodeURIComponent((req.url??'/').split('?')[0]);}catch{res.writeHead(400);res.end();return;}
 const base=path.join(root,'dist'),requested=path.resolve(base,'.'+decoded);if(requested!==base&&!requested.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
 const file=fs.existsSync(requested)&&fs.statSync(requested).isFile()?requested:path.join(base,'index.html');
 if(!fs.existsSync(file)){res.writeHead(503);res.end('Run npm run build first');return;}
 const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':file.endsWith('index.html')?'no-cache':'public, max-age=3600'});fs.createReadStream(file).pipe(res);
});
const wss=new WebSocketServer({noServer:true,maxPayload:32768});
server.on('upgrade',(req,socket,head)=>{if(req.url!=='/ws'){socket.destroy();return;}const origin=req.headers.origin;if(origin){try{const url=new URL(origin);if(url.host!==req.headers.host){socket.destroy();return;}}catch{socket.destroy();return;}}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
function send(ws:WebSocket|null,message:ServerMessage){if(ws?.readyState===WebSocket.OPEN){if(ws.bufferedAmount>2_000_000){ws.close(1013,'slow client');return;}ws.send(JSON.stringify(message));}}
function lobby(){const message:ServerMessage={type:'lobby',rooms:rooms.list(),online:[...sessions.values()].filter(s=>s.ws?.readyState===WebSocket.OPEN).length};for(const s of sessions.values())send(s.ws,message);}
function room(id:string){const r=rooms.rooms.get(id);if(!r)return;for(const p of r.players){const s=[...sessions.values()].find(s=>s.id===p.id);if(s)send(s.ws,{type:'room',room:rooms.view(id,p.id)});}}
wss.on('connection',ws=>{
 let session:Session|null=null;const helloTimer=setTimeout(()=>{if(!session)ws.close(1008,'hello timeout');},10000);
 ws.on('pong',()=>{if(session)session.alive=true;});
 ws.on('message',data=>{try{
  let m:any;try{m=JSON.parse(data.toString());}catch{throw new RoomError('invalid_json','消息格式错误');}
  if(!m||typeof m!=='object'||typeof m.type!=='string')throw new RoomError('invalid_message','消息格式错误');
  if(m.type==='hello'){
   if(session)throw new RoomError('already_hello','连接已经初始化');
   const name=typeof m.name==='string'?m.name.trim().slice(0,16):'';
   const existing=typeof m.token==='string'?sessions.get(m.token):undefined;
   if(existing){if(existing.ws&&existing.ws!==ws)existing.ws.close(4001,'session replaced');existing.ws=ws;existing.alive=true;existing.lastSeen=Date.now();session=existing;}
   else{const token=randomBytes(32).toString('hex');session={token,id:randomBytes(12).toString('hex'),name:name||'旅人'+randomBytes(2).toString('hex').toUpperCase(),ws,lastSeen:Date.now(),requests:0,window:Date.now(),alive:true};sessions.set(token,session);}
   clearTimeout(helloTimer);const r=rooms.connect(session.id,true);send(ws,{type:'session',token:session.token,playerId:session.id,name:session.name});lobby();if(r)room(r.id);return;
  }
  if(!session)throw new RoomError('unauthenticated','请先初始化游客会话');
  const now=Date.now();if(now-session.window>10000){session.window=now;session.requests=0;}if(++session.requests>100)throw new RoomError('rate_limit','操作过于频繁，请稍后重试');session.lastSeen=now;
  const r=rooms.findPlayer(session.id);let changed=r?.id;
  switch(m.type){
   case 'list':lobby();return;
   case 'create':if(typeof m.name!=='string')throw Error('房间名称无效');changed=rooms.create(session.id,session.name,m.name,m.mode==='duel'?'duel':'quick').id;break;
   case 'join':if(typeof m.roomId!=='string')throw Error('房间号无效');changed=rooms.join(m.roomId.toUpperCase(),session.id,session.name).id;break;
   case 'leave':if(r){rooms.leave(r.id,session.id);send(ws,{type:'left'});}break;
   case 'ready':if(!r)throw Error('请先加入房间');rooms.ready(r.id,session.id,Boolean(m.ready));break;
   case 'timer':if(!r)throw Error('请先加入房间');rooms.timer(r.id,session.id,m.enabled);break;
   case 'playback-ready':if(!r)throw Error('请先加入房间');rooms.playbackReady(r.id,session.id,typeof m.playbackId==='string'?m.playbackId:'');break;
   case 'reaction':if(!r||typeof m.reactionId!=='string')throw Error('响应无效');rooms.respond(r.id,session.id,m.reactionId,r.reaction?.kind==='extra-action'?m.action:m.accept);break;
   case 'pick':if(!r||typeof m.cardId!=='string')throw Error('无效选卡');rooms.pick(r.id,session.id,m.cardId);break;
   case 'setup':if(!r)throw Error('请先加入房间');rooms.setup(r.id,session.id,m.loadouts as Loadout[]);break;
   case 'actions':if(!r||m.round!==r.battle?.round)throw Error('行动回合已失效，请重新提交');rooms.act(r.id,session.id,m.actions as Action[]);break;
   case 'declare':if(!r||m.round!==r.battle?.round)throw Error('声明回合已失效，请重新选择');rooms.declare(r.id,session.id,m.action as Action);break;
   case 'surrender':if(!r)throw Error('请先加入房间');rooms.surrender(r.id,session.id);break;
   case 'rematch':if(!r)throw Error('请先加入房间');rooms.rematch(r.id,session.id);break;
   case 'ping':send(ws,{type:'pong',time:Date.now()});return;
   default:throw new RoomError('unknown_message','不支持的操作');
  }
  if(changed)room(changed);lobby();
 }catch(e){const err=e as Error;send(ws,{type:'error',message:err.message,code:e instanceof RoomError?e.code:'invalid_action'});}});
 ws.on('error',()=>{});
 ws.on('close',()=>{clearTimeout(helloTimer);if(session&&session.ws===ws){session.ws=null;session.lastSeen=Date.now();const r=rooms.connect(session.id,false);if(r)room(r.id);lobby();}});
});
const tick=setInterval(()=>{try{const changed=rooms.tick();for(const id of changed){room(id);for(const playerId of rooms.consumeClosed(id)){const s=[...sessions.values()].find(s=>s.id===playerId);if(s)send(s.ws,{type:'room-closed',roomId:id});}}if(changed.length)lobby();}catch(e){console.error('room tick failed',e);}},250);
const heartbeat=setInterval(()=>{for(const [token,s] of sessions){if(s.ws){if(!s.alive){s.ws.terminate();continue;}s.alive=false;s.ws.ping();}else if(Date.now()-s.lastSeen>3_600_000&&!rooms.findPlayer(s.id))sessions.delete(token);}},15000);
server.listen(port,host,()=>console.log('末日黎明 server http://localhost:'+port+' ('+(production?'production':'development')+')'));
function shutdown(){clearInterval(tick);clearInterval(heartbeat);for(const ws of wss.clients)ws.close(1001,'server shutdown');server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);


