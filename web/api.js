(function(root){
  'use strict';
  let token='';
  async function request(path,method='GET',body){
    const headers={};if(method!=='GET')headers['X-L2E-Token']=token;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const value=await response.json();if(!response.ok){const err=new Error(window.L2E_I18N.language==='en'?(value.errorEn||'Request failed. Check the bank or records file.'):(value.error||'请求失败'));err.status=response.status;throw err;}return value;
  }
  async function init(){const session=await request('/api/session');token=session.token;return session;}
  const draftKey=key=>`lecture2exam-draft:${key}`;
  function readDraft(key){try{return JSON.parse(localStorage.getItem(draftKey(key)));}catch(_){return null;}}
  function clearDraft(key){try{localStorage.removeItem(draftKey(key));}catch(_){}}
  class SaveQueue{
    constructor(data,onStatus){this.key=data.key;this.revision=data.revision;this.bankRevision=data.bankRevision;this.onStatus=onStatus;this.pending=null;this.running=null;this.error=null;this.paused=false;}
    draft(state){try{localStorage.setItem(draftKey(this.key),JSON.stringify({revision:this.revision,bankRevision:this.bankRevision,state}));}catch(_){/* disk remains authoritative; the pending in-memory state can be exported */}}
    save(state){this.pending=JSON.parse(JSON.stringify(state));this.draft(this.pending);this.onStatus('正在保存…');if(!this.running&&!this.error&&!this.paused)this.start();}
    start(){if(this.paused)return;this.running=this.pump().finally(()=>{this.running=null;if(this.pending&&!this.error&&!this.paused)this.start();});}
    async pump(){
      while(this.pending&&!this.error&&!this.paused){
        const snapshot=this.pending;this.pending=null;
        try{
          const saved=await request(`/api/banks/${this.key}/state`,'PUT',{revision:this.revision,bankRevision:this.bankRevision,state:snapshot});
          this.revision=saved.revision;
          if(this.pending)this.draft(this.pending);else clearDraft(this.key);
          this.onStatus(this.pending?'正在保存…':'已保存到题库文件夹');
        }catch(error){this.pending=this.pending||snapshot;this.draft(this.pending);this.error=error;this.onStatus('尚未保存',error);}
      }
    }
    async flush(){while(this.paused||this.running){if(this.paused)await this.resumed;else await this.running;}if(this.error)throw this.error;}
    async pause(){if(!this.paused){this.paused=true;this.resumed=new Promise(resolve=>this.resolveResume=resolve);}while(this.running)await this.running;if(this.error)throw this.error;}
    resume(){this.paused=false;if(this.pending){this.draft(this.pending);if(!this.running&&!this.error)this.start();}this.resolveResume?.();this.resolveResume=null;this.resumed=null;}
    async retry(){this.error=null;if(this.pending)this.start();await this.flush();}
    get dirty(){return Boolean(this.pending||this.running||this.error);}
  }
  root.L2E_API={request,init,SaveQueue,readDraft,clearDraft};
})(window);
