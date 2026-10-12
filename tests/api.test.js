const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('flush waits for paused rename records and saves with the updated bank version',async()=>{
  const disk={state:null,revision:0},storage=new Map(),root={L2E_I18N:{language:'zh'}};
  const fetch=async(path,options)=>{
    const body=JSON.parse(options.body);
    if(body.bankRevision!=='renamed-version')return {ok:false,status:409,json:async()=>({error:'题库版本已改变',errorEn:'Bank version changed'})};
    disk.state=body.state;disk.revision++;
    return {ok:true,status:200,json:async()=>({revision:disk.revision})};
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/api.js'),'utf8'),{window:root,fetch,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  const queue=new root.L2E_API.SaveQueue({key:'bank',revision:0,bankRevision:'original-version'},()=>{});
  await queue.pause();queue.save({favoriteIds:['q1']});let finished=false;const flushed=queue.flush().then(()=>finished=true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'Navigation must wait until paused records can be saved');assert.equal(disk.state,null);
  queue.bankRevision='renamed-version';queue.resume();await flushed;assert.deepEqual(disk.state,{favoriteIds:['q1']});assert.equal(queue.dirty,false);assert.equal(root.L2E_API.readDraft('bank'),null);
});
