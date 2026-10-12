(function(){
  'use strict';
  const I=window.L2E_I18N,t=I.t;
  const L=window.L2E_LOGIC,H=window.L2E_HISTORY,API=window.L2E_API;
  const app=document.getElementById('app'),notice=document.getElementById('notice'),dialog=document.getElementById('confirm-dialog');
  const settingsDialog=document.getElementById('exam-settings-dialog');
  const renameDialog=document.getElementById('rename-dialog'),renameForm=document.getElementById('rename-form');
  let renameSession=null,renameSaving=false,renameRequest=0;
  let settingsFromIntro=false,settingsSaving=false;
  const labels=new Proxy({bank:'顺序练习','bank-shuffled':'乱序练习',source:'分组练习',wrong:'错题练习','error-prone':'易错题训练',favorite:'我的收藏'},{get:(o,k)=>t(o[k])});
  const typeLabels=new Proxy({mcq:'单选题',multi:'多选题',tf:'判断题'},{get:(o,k)=>t(o[k])}), locatorLabels=new Proxy({page:'PDF 第',slide:'幻灯片第',section:'章节',line:'行',cell:'单元格'},{get:(o,k)=>t(o[k])});
  let sessionInfo,data=null,state=null,questions=[],byId=new Map(),queue=null,route={name:'manager'},confirmCallback=null,banks=[],importBundle=null,formMode=null,unsavedDraft=null,multiDraft=new Map(),bankSearch='';
  const e=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const button=(label,action,attrs='',primary=false)=>`<button class="button button--${primary?'primary':'quiet'}" data-action="${action}" ${attrs}>${t(label)}</button>`;
  const uid=prefix=>`${prefix}-${crypto.randomUUID()}`;
  let trashItems=[],navigationRequest=0;
  function tell(message){document.getElementById('live-status').textContent=t(message);}
  function warning(error){notice.hidden=false;notice.innerHTML=`${e(t(error.message||error))} ${data?button(t('导出本页记录'),'export-progress')+button(t('重试保存'),'retry-save'):''}`;}
  function status(message,error){document.getElementById('save-status').textContent=t(message);if(error)warning(error);}
  function save(){if(state.practiceSession)state.practiceSessionsByKey[L.practiceKey(state.practiceSession)]=state.practiceSession;queue.save(state);}
  async function flush(){if(queue)await queue.flush();}
  function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportProgress(){download({schemaVersion:1,bankId:data.bank.id,state},`${data.bank.id}-progress.json`);}
  function confirm(title,body,label,callback){document.getElementById('exam-settings-open').hidden=true;document.getElementById('dialog-confirm').disabled=false;document.getElementById('dialog-title').textContent=title;document.getElementById('dialog-body').textContent=body;document.getElementById('dialog-confirm').textContent=label;confirmCallback=callback;dialog.showModal();}
  dialog.addEventListener('close',()=>{const callback=confirmCallback;confirmCallback=null;if(dialog.returnValue==='confirm'&&callback)Promise.resolve(callback()).catch(warning);});
  function header(title,subtitle,back='home'){return `<header class="screen-heading"><div class="screen-heading__copy"><p class="eyebrow">${e(data?.bank.course||'Lecture2Exam')} · STUDY DESK</p><h2>${e(title)}</h2><p>${e(t(subtitle))}</p></div>${button(t('返回'),back)}</header>`;}
  function headingTitle(){return data?.bank.name||'Lecture2Exam';}
  function navigate(name,extra={},replace=false,preserveScroll=false){
    ++navigationRequest;dismissRename();
    const scroll=window.scrollY;route={name,...extra};
    history[replace?'replaceState':'pushState']({bankKey:data?.key,route},'',data?`?bank=${data.key}`:name==='trash'?'?view=trash':'/');render();
    window.scrollTo(0,preserveScroll?scroll:0);app.focus({preventScroll:true});
  }
  function sourceText(q){const source=data.bank.sources.find(s=>s.id===q.sourceId);const name=q.sourceFile||source?.file||t('未知来源');const locator=q.locator||{kind:'page',value:String(q.page||'—')};const suffix=locator.kind==='page'?t(' 页'):locator.kind==='slide'?t(' 张'):'';return `${name} · ${locatorLabels[locator.kind]||t('位置')} ${locator.value}${suffix}`;}
  function answerText(q,id){return L.selectedIds(id).map(choice=>q.options.find(o=>o.id===choice)?.text).filter(Boolean).join(' / ')||t('未作答');}
  function favoriteButton(q){if(!byId.has(q.id))return '';const saved=state.favoriteIds.includes(q.id);return `<button class="favorite-toggle${saved?' favorite-toggle--saved':''}" data-action="favorite-toggle" data-id="${e(q.id)}" aria-label="${saved?t('取消收藏'):t('收藏题目')}" aria-pressed="${saved}">${saved?'★':'☆'}</button>`;}
  function ordered(q,order){return (order||q.options.map(o=>o.id)).map(id=>q.options.find(o=>o.id===id)).filter(Boolean);}
  function typeset(){window.renderMathInElement?.(app,{delimiters:[{left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false}],throwOnError:false,trust:false});}
  function dismissExamSettings(){settingsFromIntro=false;if(settingsDialog.open)settingsDialog.close('cancel');}
  function dismissRename(){++renameRequest;renameSession=null;if(renameDialog.open)renameDialog.close();}
  async function openRename(key){
    if(renameSaving)return;
    const request=navigationRequest,intent=++renameRequest,loaded=data?.key===key?data:await API.request(`/api/banks/${key}`);
    if(request!==navigationRequest||intent!==renameRequest)return;
    renameSession={key,bankRevision:loaded.bankRevision,data:data?.key===key?data:null,queue:data?.key===key?queue:null};
    document.getElementById('rename-name').value=loaded.bank.name;
    document.getElementById('rename-error').hidden=true;
    renameDialog.showModal();document.getElementById('rename-name').select();
  }
  async function submitRename(event){
    event.preventDefault();if(renameSaving||!renameSession)return;
    const session=renameSession,name=document.getElementById('rename-name').value.trim(),error=document.getElementById('rename-error');
    if(!name){error.textContent=t('题库名称不能为空。');error.hidden=false;return;}
    renameSaving=true;renameForm.querySelectorAll('button,input').forEach(el=>el.disabled=true);error.hidden=true;
    try{
      if(session.queue)await session.queue.pause();
      const renamed=await API.request(`/api/banks/${session.key}/rename`,'POST',{name,bankRevision:session.bankRevision});
      if(session.queue)session.queue.bankRevision=renamed.bankRevision;
      if(session.data){session.data.bank=renamed.bank;session.data.bankRevision=renamed.bankRevision;}
      if(data===session.data&&data){document.title=`${headingTitle()} · Lecture2Exam`;document.getElementById('active-bank-name').textContent=headingTitle();}
      const entry=banks.find(bank=>bank.key===session.key);if(entry)entry.name=renamed.bank.name;
      if(renameSession===session){dismissRename();notice.hidden=true;
        if(data===session.data&&data)renderKeepScroll();
        else if(route.name==='manager')renderRecentBanks();
        tell(t('题库名称已更新。'));
      }
    }catch(exc){if(renameSession===session&&renameDialog.open){error.textContent=exc.message;error.hidden=false;}}
    finally{if(session.queue)session.queue.resume();renameSaving=false;renameForm.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
  }
  renameForm.addEventListener('submit',submitRename);
  renameDialog.addEventListener('cancel',event=>{if(renameSaving)event.preventDefault();else dismissRename();});

  async function manager(push=true){
    const request=++navigationRequest;
    dismissExamSettings();
    dismissRename();
    await flush();if(request!==navigationRequest)return false;multiDraft.clear();data=null;state=null;queue=null;questions=[];byId=new Map();formMode=null;importBundle=null;unsavedDraft=null;route={name:'manager'};bankSearch='';
    notice.hidden=true;status('');document.title='Lecture2Exam';document.getElementById('active-bank-name').textContent='';document.getElementById('active-bank-name').hidden=true;document.getElementById('switch-bank').hidden=true;
    const result=await API.request('/api/banks');if(request!==navigationRequest)return false;banks=result.banks;
    history[push?'pushState':'replaceState']({route},'','/');renderManager();
    return true;
  }
  function renderManager(){
    app.innerHTML=`<section class="screen"><p class="eyebrow">LOCAL STUDY DESK</p><h1>${t("从课程材料，")}<br>${t("到练习与考试。")}</h1><p class="manager-intro">${I.language==='en'?'Use ':'需要配合 '}<a href="https://github.com/Ru1zh/question-bank-builder" target="_blank" rel="noopener noreferrer">question-bank-builder</a>${I.language==='en'?' to generate a bank beforehand, then import it.':' 使用，提前生成题库，再导入'}</p><div class="manager-actions">${button(t('打开题库文件夹'),'form-open','',true)}${button(t('创建题库'),'form-create')}${button(t('导入题库'),'form-import')}${button(t('回收站'),'trash-open')}</div><div id="bank-form-host"></div><div class="manager-section"><div class="recent-heading"><h2>${t("最近使用的题库")}</h2><input type="search" id="bank-search" value="${e(bankSearch)}" aria-label="${I.language==='en'?'Search bank names':'搜索题库名称'}" placeholder="${I.language==='en'?'Search bank names':'搜索题库名称'}"></div><div class="bank-list" id="recent-bank-list"></div></div><div class="manager-section"><h3>${t("先试用现有题库")}</h3><p>${t("选择目标文件夹后导入；每个示例会生成独立记录。")}</p><div class="manager-actions">${button(t('多格式示例 · 8 题'),'example','data-example="multi-format"')}</div></div></section>`;
    renderRecentBanks();
    document.getElementById('bank-search').addEventListener('input',event=>{bankSearch=event.target.value;renderRecentBanks();});
    if(formMode)renderForm();
  }
  function renderRecentBanks(){
    const host=document.getElementById('recent-bank-list');if(!host)return;
    const query=bankSearch.trim().toLowerCase(),visible=banks.filter(bank=>bank.name.toLowerCase().includes(query));
    host.innerHTML=visible.length?visible.map(b=>{
      const summary=b.statsAvailable?(I.language==='en'?`${b.questionCount} questions · ${b.practicedCount} practiced · ${b.examCount} exams`:`共 ${b.questionCount} 题 · 已练习 ${b.practicedCount} 题 · ${b.examCount} 次考试记录`):(I.language==='en'?'Statistics unavailable; check the bank folder.':'统计暂不可用，请检查题库文件夹。');
      return `<article class="bank-entry"><div class="bank-entry__copy"><h3>${e(b.name)}</h3><p class="bank-path">${e(b.course)}</p><p class="bank-summary">${e(summary)}</p></div><div class="form-actions">${button(t('打开'),'open-bank',`data-key="${b.key}" aria-label="${t("打开 ")}${e(b.name)}"`,true)}${button(t('重命名'),'rename-bank',`data-key="${b.key}" aria-label="${t('重命名 ')}${e(b.name)}"`)}${button(t('删除'),'delete-bank',`data-key="${b.key}" aria-label="${t("删除 ")}${e(b.name)}"`)}</div></article>`;
    }).join(''):banks.length?`<p>${I.language==='en'?'No matching banks.':'没有匹配的题库。'}</p>`:t('<p>还没有题库。先创建一个题库，或打开准备好的题库文件夹。</p>');
  }
  async function openTrash(replace=false){
    const request=++navigationRequest,result=await API.request('/api/trash');
    if(request!==navigationRequest)return false;
    trashItems=result.items;
    navigate('trash',{},replace);
  }
  function renderTrash(){
    app.innerHTML=`<section class="screen">${header(t('回收站'),t('删除的题库及做题记录保存在这里，可恢复到原文件夹。彻底删除后无法恢复。'),'trash-back')}<div class="bank-list">${trashItems.length?trashItems.map(item=>`<article class="bank-entry"><div class="bank-entry__copy"><h3>${e(item.name)}</h3><p class="bank-path">${e(item.course)}</p><p class="bank-summary">${item.deletedAt?`${t('删除时间：')}${e(new Date(item.deletedAt).toLocaleString(I.language==='en'?'en-US':'zh-CN'))}`:t('此前删除的题库')}</p></div><div class="form-actions">${button(t('恢复'),'trash-restore',`data-id="${e(item.id)}" aria-label="${t('恢复 ')}${e(item.name)}"`,true)}${button(t('彻底删除'),'trash-purge',`data-id="${e(item.id)}" aria-label="${t('彻底删除 ')}${e(item.name)}"`)}</div></article>`).join(''):`<div class="empty-panel">${t('回收站为空。')}</div>`}</div></section>`;
  }
  async function refreshTrash(){
    const [deleted,recent]=await Promise.all([API.request('/api/trash'),API.request('/api/banks')]);
    trashItems=deleted.items;banks=recent.banks;notice.hidden=true;
    if(route.name==='trash')renderTrash();else if(route.name==='manager')renderRecentBanks();
  }
  async function refreshRecentBanks(){const result=await API.request('/api/banks');banks=result.banks;renderRecentBanks();}
  function renderForm(){
    const creating=formMode==='create', importing=formMode==='import';
    const name=importBundle?.bank.name||'';
    const suggested=sessionInfo.defaultParent+(name?'/'+importBundle.bank.id:'');
    document.getElementById('bank-form-host').innerHTML=`<form id="bank-form" class="bank-form"><h3>${creating?t('创建空题库'):importing?t('导入题库'):t('打开题库文件夹')}</h3>${creating?t('<label for="bank-name">题库名称</label><input id="bank-name" name="name" required placeholder="例如 课程期中"><label for="course-name">课程名称／代码</label><input id="course-name" name="course" placeholder="例如 COURSE101">'):''}<label for="bank-path">${t("题库文件夹路径")}</label><div class="path-row"><input id="bank-path" name="path" required value="" placeholder="${e(suggested)}">${sessionInfo.nativePicker?button(t('选择文件夹'),'pick-path','type="button"'):''}</div><small>${formMode==='open'?t('选择包含 bank.json 与 questions.json 的题库文件夹。'):t('填写新文件夹的完整路径，或选择空文件夹；已有内容不会覆盖。选择父目录后，请在路径末尾填写新文件夹名称。')}</small>${importing?`<label for="bank-package">${t("题库 JSON 包")}</label>${sessionInfo.nativePicker?button(t('选择 JSON 包'),'pick-package','type="button"'):''}<input id="bank-package" type="file" accept=".json,application/json" ${sessionInfo.nativePicker?'hidden':importBundle?'':'required'}><small id="import-info">${importBundle?t('已载入：')+e(name)+' · '+importBundle.questions.length+t(' 题'):t('选择 skill 生成或应用导出的题库包。原始材料如需保留，可放入题库的 sources/。')}</small>`:''}<div class="form-actions"><button class="button button--primary" type="submit">${creating?t('创建并打开'):importing?t('导入并打开'):t('打开题库')}</button>${button(t('取消'),'form-cancel','type="button"')}</div></form>`;
    if(importing)document.getElementById('bank-package').addEventListener('change',async event=>{
      const file=event.target.files[0];if(!file)return;
      try{const bundle=JSON.parse(await file.text());if(!bundle?.bank||!Array.isArray(bundle.questions))throw new Error(t('题库包必须包含 bank 与 questions。'));importBundle=bundle;document.getElementById('import-info').textContent=`${t("已载入：")}${bundle.bank.name} · ${bundle.questions.length} ${t("题 · ")}${file.name}`;}catch(error){event.target.value='';warning(error);}
    });
    document.getElementById('bank-form').addEventListener('submit',async event=>{
      event.preventDefault();const submit=event.target.querySelector('[type=submit]');submit.disabled=true;
      try{
        const form=new FormData(event.target);const path=String(form.get('path')).trim();let entry;
        if(creating)entry=await API.request('/api/banks/create','POST',{path,name:String(form.get('name')).trim(),course:String(form.get('course')||'').trim()});
        else if(importing){if(!importBundle&&!document.getElementById('bank-package').files[0])throw new Error(t('请先选择题库 JSON 包。'));const file=document.getElementById('bank-package').files[0];const bundle=file?JSON.parse(await file.text()):importBundle;entry=await API.request('/api/banks/import','POST',{path,bundle});}
        else entry=await API.request('/api/banks/open','POST',{path});
        await openBank(entry.key);
      }catch(error){warning(error);submit.disabled=false;}
    });
  }
  async function openBank(key,restoreRoute=null,replace=false,markOpened=!replace){
    const request=++navigationRequest;
    dismissExamSettings();
    dismissRename();
    await flush();if(request!==navigationRequest)return false;multiDraft.clear();const loaded=markOpened?await API.request(`/api/banks/${key}/open`,'POST',{}):await API.request(`/api/banks/${key}`);
    if(request!==navigationRequest)return false;
    data=loaded;questions=L.prepareQuestions(data.bank,data.questions);byId=new Map(questions.map(q=>[q.id,q]));
    state=L.normalizeState(data.state,questions,data.bank);unsavedDraft=API.readDraft(key);notice.hidden=true;
    queue=new API.SaveQueue(data,status);status(t('已保存到题库文件夹'));
    if(unsavedDraft){
      if(unsavedDraft.bankRevision===data.bankRevision&&unsavedDraft.revision===data.revision){try{const preview=await API.request('/api/validate-state','POST',{state:unsavedDraft.state});if(request!==navigationRequest)return false;state=L.normalizeState(preview.state,questions,data.bank);queue.save(state);unsavedDraft=null;}catch(error){notice.hidden=false;notice.innerHTML=`${t("未保存草稿校验失败：")}${e(error.message)} ${button(t('导出未保存记录'),'export-draft')}${button(t('使用磁盘记录并清除草稿'),'discard-draft')}`;}}
      else if(JSON.stringify(unsavedDraft.state)===JSON.stringify(data.state)){API.clearDraft(key);unsavedDraft=null;}
      else{notice.hidden=false;notice.innerHTML=`${t("发现本浏览器的未保存记录。磁盘已有不同版本，已保留两份数据。")}${button(t('导出未保存记录'),'export-draft')}${button(t('使用磁盘记录并清除草稿'),'discard-draft')}`;}
    }
    if(data.state.examSession&&!state.examSession)warning(new Error(t('当前考试记录格式无效，已保留原磁盘文件；请先导出备份并检查记录。历史考试仍可查看。')));
    document.title=`${headingTitle()} · Lecture2Exam`;document.getElementById('active-bank-name').textContent=headingTitle();document.getElementById('active-bank-name').hidden=false;document.getElementById('switch-bank').hidden=false;
    route=restoreRoute||{name:'home'};
    if(state.examSession&&!state.examSession.submittedAt&&state.examSession.deadline<=Date.now()){L.finalizeExam(state,data.bank.mastery);save();if(route.name==='exam')route={name:'results',id:state.examSession.id};}
    history[replace?'replaceState':'pushState']({bankKey:key,route},'',`?bank=${key}`);render();
  }
  function builderPrompt(){return `${t("使用 question")}-bank-builder skill，${t("读取我指定的课程材料")}（PDF、PPT/PPTX、Word、Markdown ${t("或 Jupyter")}），${t("设置题库：")}${data.bank.name}。\n${t("目标文件夹：")}${data.path}\n${t("请先确认题库覆盖范围、题库题量、题型和题目／解析语言；更新 bank.json 与 questions.json，生成可导入的题库 JSON 包。仅准备可复用题目，考试由我在应用内选择范围、题型、题量、分值和时长后生成。")}\n${t("保留题目稳定 ID，不改动 records/；逐题核查答案与材料来源定位。")}`;}
  function renderHome(){
    const wrong=Object.values(state.masteryById).filter(r=>r.inWrongSet).length,prone=Object.values(state.masteryById).filter(r=>r.errorProne).length;
    const practiced=new Set(Object.values(state.practiceSessionsByKey).flatMap(s=>Object.keys(s.answered||{}))).size;
    const active=state.examSession&&!state.examSession.submittedAt;
    let examError='';try{L.createExam(currentExamBank(),questions);}catch(error){examError=error.message;}
    app.innerHTML=`<section class="screen"><div class="topline"><p class="eyebrow">${e(data.bank.course||'COURSE')}</p><span class="brand-mark">${questions.length} QUESTIONS / LOCAL STUDY DESK</span></div><div class="home-hero"><div class="hero-copy"><p class="eyebrow">LEARN · PRACTICE · REVIEW</p><div class="bank-title-row"><h1>${e(data.bank.name)}</h1><button class="rename-icon" data-action="rename-bank" data-key="${e(data.key)}" aria-label="${t('修改题库名称')}" title="${t('修改题库名称')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M15 5l4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button></div><p class="hero-intro">${e(data.bank.description||`${t("按材料顺序或乱序复习 ")}${questions.length} ${t("道题，追踪错题与收藏，并完成限时模拟考试。")}`)}</p><p class="hero-note">${t("当前记录：已练习 ")}${practiced} ${t("道 · ")}${wrong} ${t("道错题 · ")}${prone} ${t("道易错题 · ")}${state.favoriteIds.length} ${t("道收藏")}</p><div class="progress-tools"><button data-action="export-progress">${t("导出做题记录")}</button><button data-action="import-progress">${t("导入做题记录")}</button><button data-action="export-bank">${t("导出题库")}</button></div></div><div class="mode-stack"><button class="mode-card" data-action="practice-menu" ${questions.length?'':'disabled'}><strong>${t("练习模式")}</strong><span class="mode-card__english">PRACTICE MODE</span></button><button class="mode-card mode-card--dark" data-action="${active?'resume-exam':'exam-intro'}" ${active||questions.length?'':'disabled'}><strong>${active?t('继续考试'):t('考试模式')}</strong><span class="mode-card__english">${active?'CONTINUE EXAM':'EXAM MODE'}</span></button><button class="mode-card" data-action="statistics"><strong>${t("考试统计")}</strong><span class="mode-card__english">EXAM STATISTICS</span></button>${examError?`<p class="bank-path">${e(examError)}</p>`:''}</div></div>${!questions.length?`<section class="empty-bank"><h2>${t("题库目前为空")}</h2><p>${t("文件夹已创建。将以下提示复制给 Codex，并附上课程材料；题库生成后点击")}“${t("重新载入题库")}”。</p><pre class="skill-prompt">${e(builderPrompt())}</pre><div class="form-actions">${button(t('复制设置提示'),'copy-prompt')}${button(t('重新载入题库'),'reload-bank','',true)}</div></section>`:''}</section>`;
  }
  function listFor(mode,group){
    let list=questions;
    if(mode==='source')list=list.filter(q=>q.groupId===group);
    if(mode==='wrong')list=list.filter(q=>state.masteryById[q.id]?.inWrongSet);
    if(mode==='error-prone')list=list.filter(q=>state.masteryById[q.id]?.errorProne);
    if(mode==='favorite')list=list.filter(q=>state.favoriteIds.includes(q.id));
    return L.sortByCourseware(list);
  }
  function syncCollections(){
    for(const mode of ['wrong','error-prone','favorite']){
      const session=state.practiceSessionsByKey[mode];if(!session)continue;
      const ids=listFor(mode).map(q=>q.id),current=session.questionIds[session.index];
      session.questionIds=ids;session.index=Math.max(0,ids.indexOf(current));
      session.answered=Object.fromEntries(Object.entries(session.answered||{}).filter(([id])=>ids.includes(id)));
      for(const id of ids)if(!session.optionOrder[id])session.optionOrder[id]=L.optionIds(byId.get(id));
    }
  }
  function renderPracticeMenu(){syncCollections();const cards=[{mode:'bank',label:t('题库练习'),count:questions.length,action:'bank-menu',copy:t('选择顺序练习或乱序练习。'),cta:t('选择方式')},{mode:'source',count:data.bank.groups.length,action:'source-menu',copy:t('按课程材料分组练习。'),cta:t('选择分组')},...['wrong','error-prone','favorite'].map(mode=>({mode,count:listFor(mode).length,action:'start-practice',copy:mode==='wrong'?t('练习尚未掌握的错题。'):mode==='error-prone'?`${t("累计答错 ")}${data.bank.mastery?.wrongThreshold||3} ${t("次后进入；连续答对 ")}${data.bank.mastery?.correctStreak||2} ${t("次后掌握。")}`:t('集中复习收藏的题目。'),cta:state.practiceSessionsByKey[mode]?.questionIds.length?t('继续练习'):t('开始练习')}))];app.innerHTML=`<section class="screen">${header(t('练习模式'),t('不同训练方式分别保存进度。'))}<div class="practice-grid">${cards.map(c=>`<article class="practice-card"><div><span class="practice-card__number">${c.count}</span><h3>${c.label||labels[c.mode]}</h3><p>${e(c.copy)}</p></div>${button(c.cta,c.action,`data-mode="${c.mode}"`,true)}</article>`).join('')}</div></section>`;}
  function renderBankMenu(){app.innerHTML=`<section class="screen">${header(t('题库练习'),t('顺序与乱序分别保存进度。'),'practice-menu')}<div class="bank-choice-grid">${['bank','bank-shuffled'].map(mode=>`<button class="bank-choice" data-action="start-practice" data-mode="${mode}"><span class="bank-choice__title">${labels[mode]}</span><span class="bank-choice__copy">${mode==='bank'?t('按材料和来源位置排列'):t('随机排列题目，顺序随进度保存')}${t("全部 ")}${questions.length} ${t("题。")}</span><span class="bank-choice__action">${practiceProgress(mode)} →</span></button>`).join('')}</div></section>`;}
  function practiceProgress(key){const session=state.practiceSessionsByKey[key];return session?`${t("继续 · 第 ")}${session.index+1} / ${session.questionIds.length} ${t("题")}`:t('开始');}
  function renderSources(){app.innerHTML=`<section class="screen">${header(t('分组练习'),t('每组末题可进入下一组；首题可返回上一组。'),'practice-menu')}<div class="source-list">${data.bank.groups.map((g,i)=>`<button class="source-row" data-action="start-practice" data-mode="source" data-group="${e(g.id)}"><span class="source-row__index">${i+1}</span><span class="source-row__name"><strong>${e(g.label)}</strong><small>${e(data.bank.sources.filter(s=>s.groupId===g.id).map(s=>s.file).join(' · '))}</small></span><span class="source-row__count">${listFor('source',g.id).length} ${t("题")}<small>${Object.keys(state.practiceSessionsByKey['source:'+g.id]?.answered||{}).length} ${t("已作答")}</small></span><span class="source-row__action">${practiceProgress('source:'+g.id)} →</span></button>`).join('')}</div></section>`;}
  function startPractice(mode,group,restart=false,end=false){
    multiDraft.clear();syncCollections();const key=L.practiceKey({mode,sourceGroup:group});let session=state.practiceSessionsByKey[key];
    if(!session||restart){multiDraft.clear();let qs=listFor(mode,group);if(mode==='bank-shuffled')qs=L.shuffle(qs);session={mode,...(group?{sourceGroup:group}:{}),questionIds:qs.map(q=>q.id),index:0,answered:{},optionOrder:Object.fromEntries(qs.map(q=>[q.id,L.optionIds(q)]))};state.practiceSessionsByKey[key]=session;}
    if(end)session.index=Math.max(0,session.questionIds.length-1);state.practiceSession=session;save();navigate('practice');
  }
  function questionMap(qs,index,statusFor,action,title,grouped=false,flaggedIds=[]){
    const groups=grouped?['mcq','multi','tf']:['all'];const names={unanswered:t('未作答'),answered:t('已作答'),correct:t('正确'),wrong:t('错误')};
    const count=qs.filter(q=>statusFor(q)!=='unanswered').length;
    return `<aside class="side-panel question-map-panel"><p class="eyebrow">QUESTION MAP</p><h3>${e(title)}</h3><p class="question-map-summary">${t("已作答 ")}${count} / ${qs.length} ${t("题")}</p><div class="question-navigator">${groups.map(type=>`${grouped&&qs.some(q=>q.type===type)?`<p class="question-map-group-title">${typeLabels[type]}：</p>`:''}${qs.map((q,i)=>{if(type!=='all'&&q.type!==type)return '';const status=statusFor(q);return `<button class="nav-number nav-number--${status}${i===index?' nav-number--current':''}${flaggedIds.includes(q.id)?' nav-number--flagged':''}" data-action="${action}" data-index="${i}" aria-label="${t("第 ")}${i+1} ${t("题，")}${names[status]}${flaggedIds.includes(q.id)?'，'+t('待检查'):''}">${i+1}</button>`;}).join('')}`).join('')}</div><div class="legend"><span><i class="legend-unanswered"></i>${t("未作答")}</span>${action==='exam-go'?t('<span><i class="legend-answered"></i>已作答</span>')+`<span><i class="legend-flagged"></i>${t('待检查')}</span>`:t('<span><i class="legend-correct"></i>正确</span><span><i class="legend-wrong"></i>错误</span>')}</div></aside>`;
  }
  function feedback(q,response){const record=state.masteryById[q.id];const mastery=state.practiceSession.mode==='error-prone'?response.mastered?t('已掌握，已移出错题集和易错题。'):`${t("连续答对 ")}${record?.masteryStreak||0} / ${data.bank.mastery?.correctStreak||2}`:'';return `<section class="feedback${response.correct?'':' feedback--incorrect'}"><div class="feedback-heading"><strong>${response.correct?t('回答正确'):t('回答错误')}</strong><span>${mastery}</span></div><dl><dt>${t("正确答案")}</dt><dd>${e(answerText(q,L.correctIds(q)))}</dd><dt>${t("解释")}</dt><dd>${e(q.explanationZh)}</dd><dt>${t("知识点")}</dt><dd>${e(q.knowledgeZh)}</dd><dt>${t("来源")}</dt><dd>${e(sourceText(q))}</dd></dl></section>`;}
  function renderPractice(){
    const s=state.practiceSession;if(!s){route={name:'practice-menu'};return renderPracticeMenu();}
    const back=s.mode==='source'?'source-menu':['bank','bank-shuffled'].includes(s.mode)?'bank-menu':'practice-menu';
    const title=s.mode==='source'?data.bank.groups.find(g=>g.id===s.sourceGroup)?.label:labels[s.mode];
    if(!s.questionIds.length){app.innerHTML=`${header(title,t('当前集合没有题目。'),back)}<div class="empty-panel"><h2>${t("暂无题目")}</h2><p>${t("添加收藏或产生错题后，可在这里继续练习。")}</p></div>`;return;}
    s.index=Math.max(0,Math.min(s.index,s.questionIds.length-1));const qs=s.questionIds.map(id=>byId.get(id)),q=qs[s.index],response=s.answered[q.id];
    const groupIndex=data.bank.groups.findIndex(g=>g.id===s.sourceGroup),last=s.index===qs.length-1;
    const count=qs.filter(q=>s.answered[q.id]).length;
    app.innerHTML=`<section class="screen">${header(title,t('作答后显示答案、解析、知识点与材料来源。'),back)}<div class="question-layout"><article class="question-panel"><div class="question-topline"><span class="question-type">${typeLabels[q.type]}</span><span>${t("第 ")}${s.index+1} ${t("题 / ")}${qs.length}</span></div><p class="question-prompt">${favoriteButton(q)}<strong>${s.index+1}.</strong> ${e(q.prompt)}</p><div class="option-list">${ordered(q,s.optionOrder[q.id]).map((o,i)=>`<button class="option${response&&L.correctIds(q).includes(o.id)?' option--correct':response&&L.selectedIds(L.selectedValue(response)).includes(o.id)&&!response.correct?' option--incorrect':!response&&(multiDraft.get(q.id)||[]).includes(o.id)?' option--selected':''}" aria-pressed="${L.selectedIds(response?L.selectedValue(response):multiDraft.get(q.id)).includes(o.id)}" data-action="practice-answer" data-answer="${e(o.id)}" ${response?'disabled':''}><span class="option__key">${String.fromCharCode(65+i)}</span><span>${e(o.text)}</span></button>`).join('')}</div>${q.type==='multi'?t('<p class="multi-hint">可选择多个选项；全部选对才得分，漏选或错选不得分。</p>'):''}${q.type==='multi'&&!response?button(t('提交答案'),'practice-submit',!(multiDraft.get(q.id)||[]).length?'disabled':'',true):''}${response?feedback(q,response):''}<div class="practice-footer">${button(t('上一题'),'practice-prev',s.index===0&&(s.mode!=='source'||groupIndex<=0)?'disabled':'')}${button(last&&s.mode==='source'&&groupIndex===data.bank.groups.length-1?t('完成练习'):t('下一题'),'practice-next',last&&s.mode!=='source'?'disabled':'',true)}</div></article><div class="sidebar-stack"><aside class="side-panel"><p class="side-stat">${t("已作答 ")}<strong>${count}</strong> / ${qs.length}</p><div class="progress-track"><span style="width:${count/qs.length*100}%"></span></div><div class="side-actions">${response&&(!response.correct||s.mode==='error-prone'&&!response.mastered)?button(t('再次作答本题'),'practice-retry','',true):''}${button(t('重新开始练习'),'practice-restart')}${button(t('返回首页'),'home')}</div></aside>${questionMap(qs,s.index,q=>s.answered[q.id]?L.answerStatus(q,L.selectedValue(s.answered[q.id])):'unanswered','practice-go',t('本组做题记录'))}</div></div></section>`;
  }
  function answerPractice(value){
    const s=state.practiceSession,q=byId.get(s.questionIds[s.index]);
    if(s.answered[q.id]||!L.selectedIds(value).length||!L.selectedIds(value).every(id=>q.options.some(o=>o.id===id)))return;
    const before=state.masteryById[q.id]||L.createMasteryRecord(),correct=L.answerStatus(q,value)==='correct';
    const after=correct?L.recordCorrect(before,s.mode,data.bank.mastery):L.recordIncorrect(before,s.mode,data.bank.mastery);
    state.masteryById[q.id]=after;s.answered[q.id]={...(q.type==='multi'?{selectedIds:[...value]}:{selectedId:value}),correct,mastered:before.errorProne&&!after.errorProne,fingerprint:L.fingerprint(q)};
    multiDraft.delete(q.id);save();renderKeepScroll();tell(correct?t('回答正确'):t('回答错误'));
  }
  function movePractice(delta){const s=state.practiceSession,next=s.index+delta;if(next<0||next>=s.questionIds.length){if(s.mode!=='source')return;const index=data.bank.groups.findIndex(g=>g.id===s.sourceGroup)+delta;const group=data.bank.groups[index];if(group)startPractice('source',group.id,false,delta<0);else if(delta>0)navigate('source-menu');return;}s.index=next;save();renderKeepScroll();}
  function formatTime(ms){const sec=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
  const currentExamBank=()=>L.examBank(data.bank,state.examSettings);
  function examIntro(){
    let spec=data.bank.exam,error='';try{const bank=currentExamBank();spec=bank.exam;L.createExam(bank,questions);}catch(exc){error=exc.message;}
    const summary=`${spec.sections.map(s=>`${s.count} ${t('道')}${typeLabels[s.type]}，${t('每题 ')}${s.points} ${t('分')}`).join('；')}。${t('限时 ')}${spec.durationMinutes} ${t('分钟，超时自动提交；提交前不显示答案。')}`;
    confirm(t('开始模拟考试？'),summary+(error?'\n\n'+error:''),t('开始考试'),()=>{state.examSession={...L.createExam(currentExamBank(),questions),id:uid('exam')};save();navigate('exam');});
    document.getElementById('exam-settings-open').hidden=false;document.getElementById('dialog-confirm').disabled=!!error;
  }
  function openExamSettings(){
    settingsFromIntro=dialog.open;if(dialog.open){confirmCallback=null;dialog.close('cancel');}
    const config=state.examSettings||{...data.bank.exam,groupIds:data.bank.groups.filter(g=>data.bank.sources.some(s=>s.groupId===g.id&&s.examEligible)).map(g=>g.id)};
    const sections=new Map(config.sections.map(s=>[s.type,s]));
    document.getElementById('exam-settings-fields').innerHTML=`<p class="eyebrow">${e(data.bank.name)}</p><h2 id="exam-settings-title">${t('考试设置')}</h2><p class="settings-note">${t('设置仅用于之后开始的考试。数量设为 0 可不考该题型。')}</p><section class="exam-presets"><h3>${t('考试方案')}</h3><p class="settings-note">${t('点击方案即可应用；修改当前设置不会改变已保存的方案。')}</p><div id="exam-preset-list" class="exam-preset-list"></div><div class="preset-name"><label>${t('方案名称')}<input type="text" id="exam-preset-name" maxlength="80" autocomplete="off"></label><button type="button" id="exam-preset-save" class="button button--quiet" data-action="exam-preset-save">${t('保存为方案')}</button></div></section><fieldset class="settings-inputs"><legend class="sr-only">${t('考试设置')}</legend><label class="settings-duration">${t('考试时间（分钟）')}<input type="number" name="durationMinutes" min="0.01" step="0.01" required value="${e(config.durationMinutes)}"></label><div class="settings-type-grid"><span>${t('题型')}</span><span>${t('数量')}</span><span>${t('每题分值')}</span>${['mcq','multi','tf'].map(type=>`<strong>${typeLabels[type]}</strong><input type="number" name="${type}-count" aria-label="${typeLabels[type]} ${t('数量')}" min="0" step="1" required value="${sections.get(type)?.count||0}"><input type="number" name="${type}-points" aria-label="${typeLabels[type]} ${t('每题分值')}" min="0.01" step="0.01" required value="${sections.get(type)?.points||1}">`).join('')}</div><fieldset class="settings-range"><legend>${t('考试范围')}</legend><p class="settings-note">${t('选择分组练习中的组，所选组内的所有材料都可出题。')}</p><div class="settings-groups">${data.bank.groups.map(g=>{const qs=questions.filter(q=>q.groupId===g.id);return `<label class="settings-group"><input type="checkbox" name="groupIds" value="${e(g.id)}" ${config.groupIds.includes(g.id)?'checked':''} ${qs.length?'':'disabled'}><span><strong>${e(g.label)}</strong><small>${['mcq','multi','tf'].map(type=>`${typeLabels[type]} ${qs.filter(q=>q.type===type).length}`).join(' · ')}</small></span></label>`;}).join('')||`<p>${t('当前题库没有可选分组。')}</p>`}</div></fieldset></fieldset><p id="exam-settings-summary" class="settings-summary" aria-live="polite"></p><p id="exam-settings-error" class="settings-error" role="alert" hidden></p><div class="settings-actions"><button type="button" class="button button--quiet" data-action="exam-settings-reset">${t('恢复题库默认')}</button><div class="dialog-actions"><button type="button" class="button button--quiet" data-action="exam-settings-cancel">${t('取消')}</button><button type="submit" id="exam-settings-save" class="button button--primary">${t('保存设置')}</button></div></div>`;
    renderExamPresets();updateExamSettingsPreview();settingsDialog.showModal();
  }
  function readExamSettings(){
    const form=document.getElementById('exam-settings-form'),values=new FormData(form),sections=[];
    for(const type of ['mcq','multi','tf']){
      const count=Number(values.get(type+'-count'));if(!Number.isInteger(count)||count<0)throw new Error(t('题目数量必须是非负整数。'));
      if(count)sections.push({type,count,points:Number(values.get(type+'-points'))});
    }
    return {durationMinutes:Number(values.get('durationMinutes')),groupIds:values.getAll('groupIds'),sections};
  }
  function renderExamPresets(){
    const list=document.getElementById('exam-preset-list');if(!list)return;
    list.innerHTML=state.examPresets.map(p=>`<div class="exam-preset"><button type="button" class="preset-apply" data-action="exam-preset-apply" data-id="${e(p.id)}" aria-label="${t('应用方案 ')}${e(p.name)}"><strong>${e(p.name)}</strong><small>${p.settings.sections.reduce((n,s)=>n+s.count,0)} ${t('题')} · ${p.settings.durationMinutes} ${t('分钟')}</small></button><button type="button" class="preset-delete" data-action="exam-preset-delete" data-id="${e(p.id)}" aria-label="${t('删除方案 ')}${e(p.name)}">×</button></div>`).join('')||`<p class="settings-note">${t('暂无保存的方案。')}</p>`;
  }
  function fillExamSettings(settings){
    const form=document.getElementById('exam-settings-form'),sections=new Map(settings.sections.map(s=>[s.type,s]));
    form.elements.durationMinutes.value=settings.durationMinutes;
    for(const type of ['mcq','multi','tf']){form.elements[type+'-count'].value=sections.get(type)?.count||0;form.elements[type+'-points'].value=sections.get(type)?.points||1;}
    form.querySelectorAll('[name=groupIds]').forEach(el=>el.checked=settings.groupIds.includes(el.value));updateExamSettingsPreview();
  }
  function settingsError(error){const hint=document.getElementById('exam-settings-error');hint.textContent=error.message;hint.hidden=false;}
  async function saveNamedExamPreset(){
    try{
      const settings=readExamSettings();L.createExam(L.examBank(data.bank,settings),questions);
      const presets=L.addExamPreset(state.examPresets,document.getElementById('exam-preset-name').value,settings,uid('preset'));
      if(await saveExamPreferences({examPresets:presets},false)){document.getElementById('exam-preset-name').value='';renderExamPresets();updateExamSettingsPreview();tell(t('考试方案已保存'));}
    }catch(error){settingsError(error);}
  }
  async function applyExamPreset(id){
    const preset=state.examPresets.find(p=>p.id===id);if(!preset)return;
    fillExamSettings(preset.settings);
    try{L.createExam(L.examBank(data.bank,preset.settings),questions);await saveExamSettings(L.clone(preset.settings));}catch(error){settingsError(error);}
  }
  async function deleteExamPreset(id){
    if(await saveExamPreferences({examPresets:state.examPresets.filter(p=>p.id!==id)},false)){renderExamPresets();updateExamSettingsPreview();tell(t('考试方案已删除'));}
  }
  function updateExamSettingsPreview(){
    if(settingsSaving)return;
    const form=document.getElementById('exam-settings-form'),error=document.getElementById('exam-settings-error'),submit=document.getElementById('exam-settings-save');
    for(const type of ['mcq','multi','tf'])form.elements[type+'-points'].disabled=Number(form.elements[type+'-count'].value)===0;
    let settings;try{
      settings=readExamSettings();const bank=L.examBank(data.bank,settings);L.createExam(bank,questions);error.hidden=true;submit.disabled=false;
    }catch(exc){error.textContent=exc.message;error.hidden=false;submit.disabled=true;}
    document.getElementById('exam-preset-save').disabled=submit.disabled;
    const selected=Array.from(form.querySelectorAll('[name=groupIds]:checked')).map(el=>el.value);
    const counts=['mcq','multi','tf'].map(type=>`${typeLabels[type]} ${questions.filter(q=>selected.includes(q.groupId)&&q.type===type).length}`).join(' · ');
    const total=settings?.sections.reduce((n,s)=>n+s.count,0)||0,points=settings?.sections.reduce((n,s)=>n+s.count*s.points,0)||0;
    document.getElementById('exam-settings-summary').textContent=`${t('共 ')}${total} ${t('题')} · ${t('满分 ')}${Number(points.toFixed(2))} ${t('分')}\n${t('所选范围可用题量：')}${counts}`;
  }
  const saveExamSettings=settings=>saveExamPreferences({examSettings:settings});
  async function saveExamPreferences(changes,close=true){
    const targetState=state,targetQueue=queue,bankKey=data.key,previous=Object.fromEntries(Object.keys(changes).map(key=>[key,targetState[key]]));settingsSaving=true;settingsDialog.querySelectorAll('button,fieldset.settings-inputs,.preset-name input').forEach(el=>el.disabled=true);
    try{
      if(targetQueue.error)await targetQueue.retry();else await targetQueue.flush();Object.assign(targetState,changes);targetQueue.save(targetState);await targetQueue.flush();
      if(data?.key===bankKey){notice.hidden=true;render();if(close&&settingsDialog.open)settingsDialog.close('saved');tell(t('考试设置已保存'));return true;}
      return false;
    }catch(error){
      Object.assign(targetState,previous);targetQueue.save(targetState);if(data?.key===bankKey&&settingsDialog.open)settingsError(error);return false;
    }finally{settingsSaving=false;settingsDialog.querySelectorAll('button,fieldset.settings-inputs,.preset-name input').forEach(el=>el.disabled=false);}
  }
  document.getElementById('exam-settings-form').addEventListener('input',updateExamSettingsPreview);
  document.getElementById('exam-settings-form').addEventListener('submit',event=>{event.preventDefault();try{const settings=readExamSettings();L.createExam(L.examBank(data.bank,settings),questions);saveExamSettings(settings);}catch(error){updateExamSettingsPreview();}});
  settingsDialog.addEventListener('cancel',event=>{if(settingsSaving)event.preventDefault();});
  settingsDialog.addEventListener('close',()=>{if(settingsFromIntro&&data){settingsFromIntro=false;examIntro();}});
  function renderExam(){const s=state.examSession;if(!s){route={name:'home'};return renderHome();}if(s.submittedAt){route={name:'results',id:s.id};return renderResults();}const q=s.questions[s.currentIndex],selected=s.answers[q.id],count=s.questions.filter(q=>L.answerStatus(q,s.answers[q.id])!=='unanswered').length;app.innerHTML=`<section class="screen"><header class="exam-bar"><span class="exam-bar__title">${e(data.bank.course||data.bank.name)} ${t("模拟考试")}</span><span class="exam-bar__stat">${t("已作答")}<strong>${count} / ${s.questions.length}</strong></span><span class="exam-bar__stat">${t("剩余时间")}<strong id="exam-timer">${formatTime(s.deadline-Date.now())}</strong></span></header><div class="question-layout"><article class="question-panel"><div class="question-topline"><span class="question-type">${typeLabels[q.type]} · ${s.pointsByType[q.type]} ${t("分")}</span><span>${t("第 ")}${s.currentIndex+1} ${t("题")}</span></div><p class="question-prompt"><button class="exam-flag-button" data-action="exam-flag" aria-pressed="${s.flaggedIds.includes(q.id)}" aria-label="${s.flaggedIds.includes(q.id)?t('取消待检查'):t('标记待检查')}" title="${s.flaggedIds.includes(q.id)?t('取消待检查'):t('标记待检查')}">!</button>${s.currentIndex+1}. ${e(q.prompt)}</p><div class="option-list">${ordered(q,s.optionOrder[q.id]).map((o,i)=>`<button class="option${L.selectedIds(selected).includes(o.id)?' option--selected':''}" data-action="exam-answer" data-answer="${e(o.id)}" aria-pressed="${L.selectedIds(selected).includes(o.id)}"><span class="option__key">${String.fromCharCode(65+i)}</span><span>${e(o.text)}</span></button>`).join('')}</div>${q.type==='multi'?`<p class="multi-hint">${I.language==='en'?'Select all correct options. Partial or extra selections earn no points.':'请选择所有正确选项；漏选、多选或错选不得分。'}</p>`:''}<div class="practice-footer">${button(t('上一题'),'exam-prev',s.currentIndex===0?'disabled':'')}${button(t('下一题'),'exam-next',s.currentIndex===s.questions.length-1?'disabled':'',true)}</div></article><div class="sidebar-stack"><aside class="side-panel"><div class="side-actions">${button(`${t('检查待检查题')} (${s.flaggedIds.length})`,'exam-next-flagged',s.flaggedIds.length?'':'disabled')}${button(t('提交试卷'),'submit-exam','',true)}${button(t('返回首页'),'home')}</div><p class="side-stat">${t("返回首页或切换题库不会暂停计时。")}</p></aside>${questionMap(s.questions,s.currentIndex,q=>L.answerStatus(q,s.answers[q.id])==='unanswered'?'unanswered':'answered','exam-go',t('本次考试做题记录'),true,s.flaggedIds)}</div></div></section>`;}
  function finishExam(){if(L.finalizeExam(state,data.bank.mastery)){save();navigate('results',{id:state.examSession.id});}}
  function attempt(){return state.examHistory.find(a=>a.id===route.id);}
  function renderResults(){const a=attempt()||state.examHistory.find(a=>a.id===state.examSession?.id);if(!a){route={name:'statistics'};return renderStatistics();}app.innerHTML=`<section class="screen">${header(t('考试结果'),`${t("提交时间：")}${new Date(a.submittedAt).toLocaleString(I.language==='en'?'en-US':'zh-CN')}`,'statistics')}<div class="results-panel" style="margin-top:30px"><div class="score-hero"><div class="score-ring"><div><strong>${a.score}</strong><span> / ${a.maxScore||100}</span></div></div><div><p class="eyebrow">EXAM COMPLETE</p><h2>${t("复盘每一道题。")}</h2><div class="score-breakdown"><div><strong>${a.mcqScore??'—'} / ${a.maxByType?.mcq??'—'}</strong><span>${t("选择题得分")}</span></div>${a.maxByType?.multi!==undefined?`<div><strong>${a.multiScore??'—'} / ${a.maxByType.multi}</strong><span>${t("多选题得分")}</span></div>`:''}<div><strong>${a.tfScore??'—'} / ${a.maxByType?.tf??'—'}</strong><span>${t("判断题得分")}</span></div><div><strong>${Number.isFinite(a.elapsedMs)?formatTime(a.elapsedMs):'—'}</strong><span>${t("答题用时")}</span></div></div><p>${t("答对 ")}${a.correct??'—'} ${t("题 · 答错 ")}${a.incorrect??'—'} ${t("题 · 未作答 ")}${a.unanswered??'—'} ${t("题")}</p><div class="results-actions">${H.hasDetails(a)?button(t('查看试卷'),'history-open',`data-id="${e(a.id)}"`,true)+button(t('只看错题'),'history-open',`data-id="${e(a.id)}" data-filter="wrong"`):t('<p>此旧记录只有成绩汇总。</p>')}${button(t('考试统计'),'statistics')}${button(t('返回首页'),'home')}</div></div></div></div></section>`;}
  function trend(attempts){const width=Math.max(720,attempts.length*80+100),left=55,right=width-30,top=28,bottom=210;const points=attempts.map((a,i)=>({x:attempts.length===1?(left+right)/2:left+(right-left)*i/(attempts.length-1),y:bottom-(a.score/(a.maxScore||100))*180,pct:Math.round(a.score/(a.maxScore||100)*100)}));return `<div class="trend-wrap"><svg width="${width}" height="260" viewBox="0 0 ${width} 260" role="img" aria-label="${t("历次考试得分率折线图")}">${[0,25,50,75,100].map(p=>`<line x1="${left}" y1="${bottom-p*1.8}" x2="${right}" y2="${bottom-p*1.8}" class="trend-grid"/><text x="${left-12}" y="${bottom-p*1.8+4}" text-anchor="end" class="trend-axis">${p}%</text>`).join('')}${points.length>1?`<polyline class="trend-line" points="${points.map(p=>`${p.x},${p.y}`).join(' ')}"/>`:''}${points.map((p,i)=>`<circle class="trend-point" cx="${p.x}" cy="${p.y}" r="5"/><text class="trend-score" x="${p.x}" y="${p.y-12}" text-anchor="middle">${p.pct}%</text><text class="trend-axis" x="${p.x}" y="245" text-anchor="middle">${i+1}</text>`).join('')}</svg></div>`;}
  function renderStatistics(){const summary=H.summarize(state.examHistory),attempts=summary.attempts;const rates=attempts.map(a=>a.score/(a.maxScore||100)*100);const display=[[t('考试次数'),attempts.length],[t('最高得分率'),rates.length?Math.max(...rates).toFixed(1)+'%':'—'],[t('平均得分率'),rates.length?(rates.reduce((a,b)=>a+b,0)/rates.length).toFixed(1)+'%':'—']];app.innerHTML=`<section class="screen">${header(t('考试统计'),t('按完整试卷统计；练习记录不参与考试知识点错误率。'))}<div class="simple-stats">${display.map(([label,value])=>`<div class="simple-stat">${label}<strong>${value}</strong></div>`).join('')}</div>${attempts.length?trend(attempts):t('<p>完成第一次考试后，这里会显示成绩趋势。</p>')}<h3>${t("材料错题统计")}</h3><table class="material-stats"><thead><tr><th>${t("材料")}</th><th>${t("已作答")}</th><th>${t("答错")}</th><th>${t("错误率")}</th><th>${t("未作答")}</th></tr></thead><tbody>${summary.lectureStats.map(x=>`<tr><td>${e(x.label)}</td><td>${x.attempted}</td><td>${x.wrong}</td><td>${x.attempted?Math.round(x.wrong/x.attempted*100):0}%</td><td>${x.unanswered}</td></tr>`).join('')}</tbody></table><h3>${t("常错知识点")}</h3><table class="material-stats"><tbody>${summary.knowledgeStats.map(x=>`<tr><td><button class="knowledge-button" data-action="knowledge-open" data-source="${e(x.source)}" data-knowledge="${e(x.knowledge)}">${e(x.knowledge)}</button><small class="bank-path"> · ${e(x.source)}</small></td><td>${t("答错 ")}${x.wrong} / ${x.attempted} ${t("次")}</td></tr>`).join('')}</tbody></table><div class="topline"><h3>${t("历次考试")}</h3><div>${t("时间 ")}${button('▲','history-sort',t('data-sort="oldest" aria-label="最早在前"'))}${button('▼','history-sort',t('data-sort="newest" aria-label="最新在前"'))}</div></div>${[...attempts].sort((a,b)=>route.sort==='oldest'?a.submittedAt-b.submittedAt:b.submittedAt-a.submittedAt).map((a,i)=>`<article class="history-entry"><h3>${new Date(a.submittedAt).toLocaleString(I.language==='en'?'en-US':'zh-CN')}</h3><p>${a.score} / ${a.maxScore||100} ${t("分 · 答对 ")}${a.correct??'—'} ${t("题 · 未作答 ")}${a.unanswered??'—'} ${t("题")}</p><div class="form-actions">${button(t('查看考试结果'),'history-result',`data-id="${e(a.id)}"`)}${H.hasDetails(a)?button(t('整张试卷'),'history-open',`data-id="${e(a.id)}"`,true)+button(t('只看错题'),'history-open',`data-id="${e(a.id)}" data-filter="wrong"`):t('<span>仅有成绩汇总</span>')}</div></article>`).join('')}</section>`;}
  function reviewCard(q,selected,order,index,extra=''){const status=L.answerStatus(q,selected);return `<article class="review-card review-card--${status}" id="review-question-${index}"><div class="review-heading"><h3>${favoriteButton(q)}${index+1}. ${e(q.prompt)}</h3><span class="status-chip">${status==='correct'?t('正确'):status==='wrong'?t('错误'):t('未作答')}</span></div>${extra}<div class="review-options">${ordered(q,order).map((o,i)=>`<div class="review-option${L.correctIds(q).includes(o.id)?' review-option--correct':L.selectedIds(selected).includes(o.id)?' review-option--incorrect':''}"><span class="review-option-key">${String.fromCharCode(65+i)}</span><span>${e(o.text)}</span><small>${L.correctIds(q).includes(o.id)?t('正确答案'):L.selectedIds(selected).includes(o.id)?t('你的选择'):''}</small></div>`).join('')}</div><dl class="review-answer"><dt>${t("你的答案")}</dt><dd>${e(answerText(q,selected))}</dd><dt>${t("正确答案")}</dt><dd>${e(answerText(q,L.correctIds(q)))}</dd></dl><div class="review-explanation"><p><strong>${t("解释：")}</strong>${e(q.explanationZh)}</p><p><strong>${t("知识点：")}</strong>${e(q.knowledgeZh)}</p><p class="source-line">${e(sourceText(q))}</p></div></article>`;}
  function renderReview(){const a=attempt();if(!a||!H.hasDetails(a)){route={name:'statistics'};return renderStatistics();}const visible=a.questions.filter(q=>route.filter!=='wrong'||L.answerStatus(q,a.answers[q.id])==='wrong');app.innerHTML=`<section class="screen">${header(t('查看试卷'),`${new Date(a.submittedAt).toLocaleString(I.language==='en'?'en-US':'zh-CN')} · ${a.score} / ${a.maxScore||100} ${t("分")}`,'statistics')}<div class="collection-controls">${button(t('整张试卷'),'history-open',`data-id="${e(a.id)}"`,route.filter!=='wrong')}${button(t('只看错题'),'history-open',`data-id="${e(a.id)}" data-filter="wrong"`,route.filter==='wrong')}</div><div class="review-layout"><div class="review-list">${visible.length?visible.map(q=>reviewCard(q,a.answers[q.id],a.optionOrder?.[q.id],a.questions.indexOf(q))).join(''):t('<div class="empty-panel">本场考试没有答错的题。</div>')}</div>${questionMap(a.questions,-1,q=>L.answerStatus(q,a.answers[q.id]),'review-go',t('试卷题号'),true)}</div><button class="back-to-top" data-action="back-to-top">${t("回到顶部 ↑")}</button></section>`;}
  function renderKnowledge(){const matches=H.wrongQuestionsForKnowledge(state.examHistory,route.source,route.knowledge);app.innerHTML=`<section class="screen">${header(route.knowledge,t('同一题重复答错合并显示，保留最近一次错题作答。'),'statistics')}<div class="review-list">${matches.map((m,i)=>reviewCard(m.question,m.attempt.answers[m.question.id],m.attempt.optionOrder?.[m.question.id],i,`<p class="bank-path">${t("累计答错 ")}${m.wrongCount} ${t("次 · 原试卷第 ")}${m.questionIndex+1} ${t("题")}</p>`)).join('')}</div><button class="back-to-top" data-action="back-to-top">${t("回到顶部 ↑")}</button></section>`;}
  function render(){if(!data)return route.name==='trash'?renderTrash():renderManager();const views={'home':renderHome,'practice-menu':renderPracticeMenu,'bank-menu':renderBankMenu,'source-menu':renderSources,'practice':renderPractice,'exam':renderExam,'results':renderResults,'statistics':renderStatistics,'review':renderReview,'knowledge':renderKnowledge};(views[route.name]||renderHome)();typeset();const nav=app.querySelector('.question-navigator'),current=nav?.querySelector('.nav-number--current');if(current)nav.scrollTop=Math.max(0,current.offsetTop-nav.offsetTop-nav.clientHeight/2);}
  function renderKeepScroll(){const y=scrollY;render();scrollTo(0,y);}
  async function importProgress(file){if(!file)return;try{const parsed=JSON.parse(await file.text());let imported;if(parsed.bankId===data.bank.id&&parsed.state?.version===1)imported=parsed.state;else if(parsed.version===1){const sessions=[parsed.practiceSession,...Object.values(parsed.practiceSessionsByKey||{})].filter(Boolean),ids=[...sessions.flatMap(s=>s.questionIds||[]),...Object.keys(parsed.masteryById||{}),...(parsed.favoriteIds||[]),...(parsed.examSession?.questionIds||[]),...(parsed.examHistory||[]).flatMap(a=>a.questionIds||a.questions?.map(q=>q.id)||[])];if(!ids.length||!ids.every(id=>byId.has(id)))throw new Error(t('旧记录中的题目与当前题库不匹配。'));imported=migrateLegacy(parsed);}else throw new Error(t('记录不属于当前题库或版本不支持。'));const preview=await API.request('/api/validate-state','POST',{state:imported});const candidate=L.normalizeState(preview.state,questions,data.bank);confirm(t('导入做题记录？'),t('这会替换当前题库的记录。请先导出当前记录留底；上一份记录也会保存在 progress.json.bak。'),t('导入记录'),async()=>{await flush();state=candidate;save();await flush();navigate('home');});}catch(error){warning(error);}}
  function migrateLegacy(raw){const result=L.clone(raw);result.practiceSessionsByKey=result.practiceSessionsByKey||{};const sessions=[result.practiceSession,...Object.values(result.practiceSessionsByKey)].filter(Boolean);for(const s of sessions)for(const [id,r] of Object.entries(s.answered||{}))if(byId.has(id)&&!r.fingerprint)r.fingerprint=L.fingerprint(byId.get(id));const adapt=q=>{const current=byId.get(q.id),source=data.bank.sources.find(s=>s.file===q.sourceFile);return {...q,sourceId:q.sourceId||source?.id||current?.sourceId,locator:q.locator||current?.locator||{kind:'page',value:String(q.page||'—')}};};const points=Object.fromEntries(data.bank.exam.sections.map(s=>[s.type,s.points])),maxByType=Object.fromEntries(data.bank.exam.sections.map(s=>[s.type,s.count*s.points])),maxScore=Object.values(maxByType).reduce((a,b)=>a+b,0);for(const a of result.examHistory||[]){if(!a.id)a.id=uid('legacy');a.maxScore=a.maxScore||maxScore;a.maxByType=a.maxByType||maxByType;if(a.questions)a.questions=a.questions.map(adapt);}const exam=result.examSession;if(exam){if(!Array.isArray(exam.questions)||!exam.questions.length)exam.questions=exam.questionIds.map(id=>byId.get(id)).filter(Boolean).map(L.clone);exam.pointsByType=exam.pointsByType||points;exam.maxScore=exam.maxScore||maxScore;exam.maxByType=exam.maxByType||maxByType;if(exam.questions.length!==exam.questionIds.length)result.examSession=null;}return result;}
  async function handle(event){const target=event.target.closest('[data-action]');if(!target||target.disabled)return;const d=target.dataset,a=d.action;
    if(['exam-answer','exam-prev','exam-next','exam-go','exam-flag','exam-next-flagged','submit-exam','resume-exam'].includes(a)&&state?.examSession&&!state.examSession.submittedAt&&state.examSession.deadline<=Date.now()){finishExam();return;}
    if(a.startsWith('form-')){formMode=a==='form-cancel'?null:a.slice(5);importBundle=null;renderManager();}
    else if(a==='pick-path'){target.disabled=true;try{const result=await API.request('/api/pick-directory','POST',{language:I.language});if(result.path)document.getElementById('bank-path').value=result.path;}finally{target.disabled=false;}}
    else if(a==='pick-package'){target.disabled=true;try{const directory=document.getElementById('bank-path').value.trim();const result=await API.request('/api/pick-bank-package','POST',{directory,language:I.language});if(result.path){importBundle=result.bundle;document.getElementById('bank-package').value='';document.getElementById('import-info').textContent=`${t("已载入：")}${importBundle.bank.name} · ${importBundle.questions.length} ${t("题 · ")}${result.path.split('/').pop()}`;}}finally{target.disabled=false;}}
    else if(a==='rename-bank')await openRename(d.key);
    else if(a==='rename-cancel'&&!renameSaving)dismissRename();
    else if(a==='delete-bank'){const bank=banks.find(b=>b.key===d.key);if(bank){document.getElementById('delete-name').textContent=bank.name;document.getElementById('delete-dialog').dataset.key=bank.key;document.getElementById('delete-dialog').showModal();}}
    else if(a==='delete-registration'){
      const chooser=document.getElementById('delete-dialog'),key=chooser.dataset.key;chooser.close();
      await API.request(`/api/banks/${key}/delete`,'POST',{scope:'registration'});await refreshRecentBanks();
    }
    else if(a==='delete-whole-bank'){
      const chooser=document.getElementById('delete-dialog'),key=chooser.dataset.key,bank=banks.find(b=>b.key===key);chooser.close();
      confirm(t('删除整个题库？'),`${t("题库")}“${bank.name}”${t('及其做题记录将移入回收站，可从回收站恢复。')}`,t('确认删除整个题库'),async()=>{await API.request(`/api/banks/${key}/delete`,'POST',{scope:'bank',confirmed:true});API.clearDraft(key);await refreshRecentBanks();});
    }
    else if(a==='trash-open')await openTrash();
    else if(a==='trash-back')await manager();
    else if(a==='trash-restore'){
      target.disabled=true;try{await API.request(`/api/trash/${d.id}/restore`,'POST',{});await refreshTrash();tell(t('题库已恢复。'));}finally{target.disabled=false;}
    }
    else if(a==='trash-purge'){
      const item=trashItems.find(item=>item.id===d.id);if(!item)return;
      confirm(t('彻底删除题库？'),`${t('题库')}“${item.name}”${t('及其全部文件和做题记录将彻底删除，无法恢复。')}`,t('确认彻底删除'),async()=>{await API.request(`/api/trash/${item.id}/purge`,'POST',{confirmed:true});await refreshTrash();tell(t('题库已彻底删除。'));});
    }
    else if(a==='open-bank')await openBank(d.key);
    else if(a==='example'){importBundle=await API.request('/api/examples/'+d.example);formMode='import';renderManager();}
    else if(a==='home'||a==='practice-menu'||a==='bank-menu'||a==='source-menu'||a==='statistics')navigate(a);
    else if(a==='export-progress')exportProgress();
    else if(a==='export-bank')download({bank:data.bank,questions:data.questions},data.bank.id+'-bank.json');
    else if(a==='import-progress')document.getElementById('progress-import').click();
    else if(a==='retry-save'){await queue.retry();notice.hidden=true;}
    else if(a==='export-draft')download({schemaVersion:1,bankId:data.bank.id,state:unsavedDraft.state},data.bank.id+'-unsaved-progress.json');
    else if(a==='discard-draft')confirm(t('清除未保存草稿？'),t('磁盘记录会保留。建议先导出未保存记录。'),t('清除草稿'),()=>{API.clearDraft(data.key);unsavedDraft=null;notice.hidden=true;});
    else if(a==='copy-prompt'){await navigator.clipboard.writeText(builderPrompt());tell(t('设置提示已复制'));target.textContent=t('已复制');}
    else if(a==='reload-bank'){await flush();await openBank(data.key,null,true);}
    else if(a==='start-practice')startPractice(d.mode,d.group);
    else if(a==='practice-answer'){const s=state.practiceSession,q=byId.get(s.questionIds[s.index]);if(q.type==='multi'){if(s.answered[q.id])return;const choices=multiDraft.get(q.id)||[];multiDraft.set(q.id,choices.includes(d.answer)?choices.filter(id=>id!==d.answer):[...choices,d.answer]);renderKeepScroll();}else answerPractice(d.answer);}
    else if(a==='practice-submit'){const q=byId.get(state.practiceSession.questionIds[state.practiceSession.index]);if(q.type==='multi')answerPractice(multiDraft.get(q.id)||[]);}
    else if(a==='favorite-toggle'){state.favoriteIds=state.favoriteIds.includes(d.id)?state.favoriteIds.filter(id=>id!==d.id):[...state.favoriteIds,d.id];save();renderKeepScroll();}
    else if(a==='practice-prev'||a==='practice-next'){const y=scrollY;movePractice(a==='practice-next'?1:-1);scrollTo(0,y);}
    else if(a==='practice-go'){const s=state.practiceSession,i=Number(d.index);if(Number.isInteger(i)&&i>=0&&i<s.questionIds.length){s.index=i;save();renderKeepScroll();}}
    else if(a==='practice-restart')confirm(t('重新开始练习？'),t('只重置本训练方式的进度；错题状态、收藏和考试记录保留。'),t('重新开始'),()=>startPractice(state.practiceSession.mode,state.practiceSession.sourceGroup,true));
    else if(a==='practice-retry'){const s=state.practiceSession,id=s.questionIds[s.index];delete s.answered[id];multiDraft.delete(id);s.optionOrder[id]=L.optionIds(byId.get(id));save();renderKeepScroll();}
    else if(a==='exam-intro')examIntro();
    else if(a==='exam-settings')openExamSettings();
    else if(a==='exam-settings-cancel'&&!settingsSaving)settingsDialog.close('cancel');
    else if(a==='exam-settings-reset'&&!settingsSaving)await saveExamSettings(null);
    else if(a==='exam-preset-save'&&!settingsSaving)await saveNamedExamPreset();
    else if(a==='exam-preset-apply'&&!settingsSaving)await applyExamPreset(d.id);
    else if(a==='exam-preset-delete'&&!settingsSaving)await deleteExamPreset(d.id);
    else if(a==='resume-exam')navigate('exam');
    else if(a==='exam-flag'){const session=state.examSession;if(L.toggleExamFlag(session,session.questionIds[session.currentIndex])){save();renderKeepScroll();}}
    else if(a==='exam-next-flagged'){const session=state.examSession,indices=session.questionIds.map((id,i)=>session.flaggedIds.includes(id)?i:-1).filter(i=>i>=0);if(indices.length){session.currentIndex=indices.find(i=>i>session.currentIndex)??indices[0];save();renderKeepScroll();}}
    else if(a==='exam-answer'){const s=state.examSession;if(s.submittedAt)return;const q=s.questions[s.currentIndex];if(q.options.some(o=>o.id===d.answer)){const choices=L.selectedIds(s.answers[q.id]);s.answers[q.id]=q.type==='multi'?(choices.includes(d.answer)?choices.filter(id=>id!==d.answer):[...choices,d.answer]):d.answer;save();renderKeepScroll();}}
    else if(a==='exam-prev'||a==='exam-next'||a==='exam-go'){const s=state.examSession;const next=a==='exam-go'?Number(d.index):s.currentIndex+(a==='exam-next'?1:-1);if(Number.isInteger(next)&&next>=0&&next<s.questions.length){s.currentIndex=next;save();renderKeepScroll();}}
    else if(a==='submit-exam'){const s=state.examSession;const count=s.questions.filter(q=>L.answerStatus(q,s.answers[q.id])==='unanswered').length;const body=count?`${t("还有 ")}${count} ${t("题未作答。提交后不能修改答案。")}`:t('全部题目均已作答。提交后不能修改答案。');confirm(t('提交试卷？'),body+(s.flaggedIds.length?`\n${t('仍有待检查标记：')}${s.flaggedIds.length} ${t('题')}`:''),t('确认提交'),finishExam);}
    else if(a==='history-result')navigate('results',{id:d.id});
    else if(a==='history-open')navigate('review',{id:d.id,filter:d.filter||'all'});
    else if(a==='history-sort')navigate('statistics',{sort:d.sort},true,true);
    else if(a==='knowledge-open')navigate('knowledge',{source:d.source,knowledge:d.knowledge});
    else if(a==='review-go'){const i=Number(d.index);if(route.filter==='wrong'&&!document.getElementById('review-question-'+i)){navigate('review',{id:route.id,filter:'all'},true);}document.getElementById('review-question-'+i)?.scrollIntoView({behavior:'smooth',block:'start'});}
    else if(a==='back-to-top')scrollTo({top:0,behavior:'smooth'});
  }
  function languageChrome(){
    document.getElementById('rename-title').textContent=t('修改题库名称');
    document.querySelector('#rename-form label').textContent=t('题库名称');
    renameForm.querySelector('[data-action=rename-cancel]').textContent=t('取消');
    renameForm.querySelector('[type=submit]').textContent=t('保存');
    document.querySelectorAll('.language-picker [data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===I.language))); 
    document.getElementById('exam-settings-open').textContent=t('考试设置');
    if(!sessionInfo)app.textContent=I.language==='en'?'Opening local banks…':'正在打开本地题库…';
    document.querySelector('.skip-link').textContent=I.language==='en'?'Skip to content':'跳到主要内容';
    document.getElementById('switch-bank').textContent=I.language==='en'?'Switch bank':'切换题库';
    if(!data){document.getElementById('active-bank-name').textContent='';document.getElementById('active-bank-name').hidden=true;}
    document.querySelector('#confirm-dialog [value="cancel"]').textContent=t('取消');
    document.getElementById('delete-title').textContent=I.language==='en'?'Delete bank':'删除题库';
    document.querySelector('[data-action="delete-registration"]').textContent=I.language==='en'?'Remove bank from recents':'删除题库记录';
    document.getElementById('delete-description').textContent=I.language==='en'?'Removing a recent-bank entry keeps its files. Deleting the entire bank moves it and its learning records to the recycle bin.':'删除题库记录仅从最近列表移除；删除整个题库会将文件和做题记录移入回收站，可恢复。';
    document.querySelector('[data-action="delete-whole-bank"]').textContent=I.language==='en'?'Delete entire bank':'删除整个题库';
    document.querySelector('#delete-dialog form button').textContent=t('取消');
  }
  document.querySelector('.language-picker').addEventListener('click',event=>{
    const choice=event.target.closest('[data-language]');if(!choice||choice.dataset.language===I.language)return;
    const form=document.getElementById('bank-form'),values=form?new FormData(form):null;
    if(dialog.open){confirmCallback=null;dialog.close();}document.getElementById('delete-dialog').close();
    I.setLanguage(choice.dataset.language);languageChrome();render();
    if(values)for(const name of ['path','name','course']){const input=document.querySelector(`#bank-form [name="${name}"]`);if(input)input.value=values.get(name)||'';}
    if(queue)status(queue.dirty?'正在保存…':'已保存到题库文件夹');
  });
  languageChrome();
  document.addEventListener('click',event=>{if(event.target.closest('.app-brand')){event.preventDefault();manager().catch(warning);return;}handle(event).catch(warning);});
  document.getElementById('switch-bank').addEventListener('click',()=>manager().catch(warning));
  document.getElementById('progress-import').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';importProgress(file);});
  window.addEventListener('beforeunload',event=>{if(queue?.dirty){event.preventDefault();event.returnValue='';}});
  window.addEventListener('popstate',event=>{(async()=>{
    const request=++navigationRequest;
    dismissExamSettings();dismissRename();if(dialog.open){confirmCallback=null;dialog.close();}
    await flush();if(request!==navigationRequest)return;
    const dest=event.state;
    if(dest?.bankKey){
      if(data?.key!==dest.bankKey)await openBank(dest.bankKey,dest.route,true);
      else{route=dest.route||{name:'home'};render();}
    }else{
      const pending=manager(false),managerRequest=navigationRequest;
      if(!await pending||managerRequest!==navigationRequest)return;
      if(dest?.route?.name==='trash')await openTrash(true);
    }
  })().catch(warning);});
  setInterval(()=>{const s=state?.examSession;if(!s||s.submittedAt)return;const remaining=s.deadline-Date.now();const el=document.getElementById('exam-timer');if(el)el.textContent=formatTime(remaining);if(remaining<=0){if(dialog.open){confirmCallback=null;dialog.close();}L.finalizeExam(state,data.bank.mastery);save();if(route.name==='exam')navigate('results',{id:s.id},true);else render();}},1000);
  (async()=>{sessionInfo=await API.init();const initialView=new URLSearchParams(location.search).get('view'),key=new URLSearchParams(location.search).get('bank');if(key){const nav=performance.getEntriesByType('navigation')[0];const saved=history.state;await openBank(key,['reload','back_forward'].includes(nav?.type)&&saved?.bankKey===key?saved.route:null,true,!['reload','back_forward'].includes(nav?.type));}else{if(await manager(false)&&initialView==='trash')await openTrash(true);}})().catch(error=>{app.innerHTML=t('<h2>无法打开题库</h2><p>检查题库文件或启动本地服务后重试。</p>')+button(t('返回题库列表'),'return-manager');warning(error);});
  document.addEventListener('click',event=>{if(event.target.closest('[data-action="return-manager"]'))manager().catch(warning);});
})();
