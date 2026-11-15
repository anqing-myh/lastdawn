import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './extra.css';
import './playback.css';
import './skill-colors.css';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(e:Error){return {error:e.message};}render(){return this.state.error?<div style={{padding:48,color:'#eee',background:'#121a1b',minHeight:'100vh'}}><h1>页面出现问题</h1><p>{this.state.error}</p><button onClick={()=>location.reload()}>重新加载</button></div>:this.props.children;}}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>);

