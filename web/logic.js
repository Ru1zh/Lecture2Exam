(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.L2E_LOGIC=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const message=(zh,en)=>typeof window!=='undefined'&&window.L2E_I18N?.language==='en'?en:zh;
  const typeNames={mcq:'单选',multi:'多选',tf:'判断'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const defaultState = () => ({version:1,masteryById:{},favoriteIds:[],practiceSession:null,practiceSessionsByKey:{},examSession:null,examHistory:[],examSettings:null,examPresets:[]});
  const createMasteryRecord = () => ({wrongCount:0,inWrongSet:false,errorProne:false,masteryStreak:0});
  const practiceKey = session => session.mode==='source' ? `source:${session.sourceGroup}` : session.mode;
  const fingerprint = q => JSON.stringify([q.prompt,q.type,q.options,q.type==='multi'?[...q.answerIds].sort():q.answerId]);
  const sortByCourseware = qs => [...qs].sort((a,b)=>(a.sourceOrder||0)-(b.sourceOrder||0)||(a.page||0)-(b.page||0)||a.id.localeCompare(b.id));
  function shuffle(items,rng=Math.random){const copy=[...items];for(let i=copy.length-1;i>0;i--){const v=Number(rng());const j=Math.floor((Number.isFinite(v)?Math.min(.999999999999,Math.max(0,v)):0)*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;}
  const optionIds=(q,rng=Math.random)=>(q.type!=='tf'?shuffle(q.options,rng):q.options).map(o=>o.id);
  function prepareQuestions(bank,questions){return questions.map(q=>{const s=bank.sources.find(s=>s.id===q.sourceId);return {...q,groupId:s.groupId,sourceFile:s.file,sourceOrder:s.order,page:parseInt(q.locator.value,10)||0};});}
  function examBank(bank,settings){
    if(settings==null)return bank;
    if(!Number.isFinite(settings.durationMinutes)||settings.durationMinutes<.01)throw new Error(message('考试时长必须大于零。','Exam duration must be greater than zero.'));
    if(!Array.isArray(settings.groupIds)||!settings.groupIds.length||new Set(settings.groupIds).size!==settings.groupIds.length||!settings.groupIds.every(id=>bank.groups.some(g=>g.id===id)))throw new Error(message('请至少选择一个有效的考试分组。','Select at least one valid exam group.'));
    const sections=settings.sections;
    if(!Array.isArray(sections)||!sections.length||sections.length>3||new Set(sections.map(s=>s?.type)).size!==sections.length||!sections.every(s=>s&&['mcq','multi','tf'].includes(s.type)&&Number.isInteger(s.count)&&s.count>0&&Number.isFinite(s.points)&&s.points>=.01))throw new Error(message('请设置有效的题目数量和每题分值，至少包含一道题。','Set valid question counts and points per question, with at least one question.'));
    if(!Number.isFinite(settings.durationMinutes*60000+Date.now())||!Number.isFinite(sections.reduce((n,s)=>n+s.count*s.points,0)))throw new Error(message('考试时长或总分过大，请缩小数值。','Exam duration or maximum score is too large. Use smaller values.'));
    return {...bank,sources:bank.sources.map(s=>({...s,examEligible:settings.groupIds.includes(s.groupId)})),exam:{...bank.exam,durationMinutes:settings.durationMinutes,sections:clone(sections),coverage:[]}};
  }
  function addExamPreset(presets,name,settings,id){
    const clean=typeof name==='string'?name.trim():'';
    if(!clean||clean.length>80)throw new Error(message('方案名称须为 1–80 个字符。','Preset names must contain 1–80 characters.'));
    if(presets.some(p=>p.name.trim().toLowerCase()===clean.toLowerCase()))throw new Error(message('已有同名方案，请使用其他名称。','A preset with this name already exists. Choose another name.'));
    return [...presets,{id,name:clean,settings:clone(settings)}];
  }
  function toggleExamFlag(exam,id){
    if(!exam||exam.submittedAt!==null||!exam.questionIds.includes(id))return false;
    const flagged=exam.flaggedIds||[];exam.flaggedIds=flagged.includes(id)?flagged.filter(x=>x!==id):[...flagged,id];return true;
  }
  function createExam(bank,questions,rng=Math.random,now=Date.now()){
    const eligible=questions.filter(q=>bank.sources.some(s=>s.id===q.sourceId&&s.examEligible));
    const selected=[];
    for(const section of bank.exam.sections){
      const pool=eligible.filter(q=>q.type===section.type), picked=[], counts=new Map();
      const rules=new Map((bank.exam.coverage||[]).map(c=>[c.sourceId,c]));
      for(const [sourceId,rule] of rules){
        const min=rule.minimum?.[section.type]||0;
        const available=shuffle(pool.filter(q=>q.sourceId===sourceId),rng);
        if(available.length<min)throw new Error(message(`${sourceId} 的${typeNames[section.type]}题不足：最低需要 ${min} 道。`,`${sourceId}: not enough ${section.type} questions; minimum ${min} required.`));
        picked.push(...available.slice(0,min));counts.set(sourceId,min);
      }
      if(picked.length>section.count)throw new Error(message('最低配额之和超过考试题数。','Minimum quotas exceed the exam question count.'));
      while(picked.length<section.count){
        let candidates=pool.filter(q=>!picked.some(p=>p.id===q.id)&&(counts.get(q.sourceId)||0)<(rules.get(q.sourceId)?.maximum?.[section.type]??Infinity));
        if(!candidates.length)throw new Error(message(`${typeNames[section.type]}题不足或最高配额限制过严，需要 ${section.count} 道。请调整题库或考试配置.`, `Not enough ${section.type} questions under the configured limits; ${section.count} required. Adjust the bank or exam settings.`));
        if(bank.exam.sampling==='balanced'){
          const sourceIds=shuffle([...new Set(candidates.map(q=>q.sourceId))],rng);
          sourceIds.sort((a,b)=>(counts.get(a)||0)-(counts.get(b)||0));
          candidates=candidates.filter(q=>q.sourceId===sourceIds[0]);
        }
        const q=shuffle(candidates,rng)[0];picked.push(q);counts.set(q.sourceId,(counts.get(q.sourceId)||0)+1);
      }
      selected.push(...sortByCourseware(picked));
    }
    const snapshots=clone(selected), pointsByType=Object.fromEntries(bank.exam.sections.map(s=>[s.type,s.points]));
    return {questionIds:snapshots.map(q=>q.id),questions:snapshots,optionOrder:Object.fromEntries(snapshots.map(q=>[q.id,optionIds(q,rng)])),
      answers:{},flaggedIds:[],startedAt:now,deadline:now+bank.exam.durationMinutes*60000,currentIndex:0,submittedAt:null,statsApplied:false,
      pointsByType,maxScore:bank.exam.sections.reduce((n,s)=>n+s.count*s.points,0),maxByType:Object.fromEntries(bank.exam.sections.map(s=>[s.type,s.count*s.points]))};
  }
  const selectedValue = response => response?.selectedIds ?? response?.selectedId;
  const correctIds = q => q.type==='multi'?q.answerIds:[q.answerId];
  const selectedIds = value => Array.isArray(value)?value:typeof value==='string'?[value]:[];
  function answerStatus(q,value){
    if(q.type==='multi'){
      if(value==null||Array.isArray(value)&&!value.length)return 'unanswered';
      if(!Array.isArray(value)||new Set(value).size!==value.length||!value.every(id=>q.options.some(o=>o.id===id)))return 'wrong';
      return value.length===q.answerIds.length&&q.answerIds.every(id=>value.includes(id))?'correct':'wrong';
    }
    if(!q.options.some(o=>o.id===value))return 'unanswered';return value===q.answerId?'correct':'wrong';
  }
  function scoreExam(exam,answers=exam.answers){const score={total:0,mcq:0,multi:0,tf:0,correct:0,incorrect:0,unanswered:0};for(const q of exam.questions){const status=answerStatus(q,answers[q.id]);if(status==='unanswered')score.unanswered++;else if(status==='correct'){const points=exam.pointsByType[q.type];score.total+=points;score[q.type]+=points;score.correct++;}else score.incorrect++;}return score;}
  function recordIncorrect(record,mode,config={wrongThreshold:3,correctStreak:2}){const next={...createMasteryRecord(),...record};next.wrongCount++;next.inWrongSet=true;if(next.wrongCount>=config.wrongThreshold)next.errorProne=true;if(mode==='error-prone')next.masteryStreak=0;return next;}
  function recordCorrect(record,mode,config={wrongThreshold:3,correctStreak:2}){const next={...createMasteryRecord(),...record};if(mode==='error-prone'&&next.errorProne){next.masteryStreak++;if(next.masteryStreak>=config.correctStreak)return createMasteryRecord();}if(mode==='wrong'&&!next.errorProne)next.inWrongSet=false;return next;}
  function finalizeExam(state,mastery,now=Date.now()){
    const session=state.examSession;if(!session||session.submittedAt!==null)return false;
    session.submittedAt=now;session.elapsedMs=Math.min(session.deadline-session.startedAt,Math.max(0,now-session.startedAt));session.score=scoreExam(session);
    if(!session.statsApplied){for(const q of session.questions){if(answerStatus(q,session.answers[q.id])==='wrong')state.masteryById[q.id]=recordIncorrect(state.masteryById[q.id],'exam',mastery);}session.statsApplied=true;}
    if(!state.examHistory.some(x=>x.id===session.id))state.examHistory.push({...clone(session),score:session.score.total,mcqScore:session.score.mcq,multiScore:session.score.multi,tfScore:session.score.tf,correct:session.score.correct,incorrect:session.score.incorrect,unanswered:session.score.unanswered});
    return true;
  }
  function normalizeState(input,questions,bank){
    const state={...defaultState(),...clone(input)},byId=new Map(questions.map(q=>[q.id,q]));
    state.favoriteIds=[...new Set(state.favoriteIds)].filter(id=>byId.has(id));
    state.masteryById=Object.fromEntries(Object.entries(state.masteryById).filter(([id])=>byId.has(id)));
    function session(s){
      if(!s||!Array.isArray(s.questionIds)||!['bank','bank-shuffled','source','wrong','error-prone','favorite'].includes(s.mode))return null;
      if(s.mode==='source'&&!bank.groups.some(g=>g.id===s.sourceGroup))return null;
      const current=s.questionIds[s.index],ids=[...new Set(s.questionIds)].filter(id=>byId.has(id));
      if(!ids.length)return null;
      const answered=Object.fromEntries(Object.entries(s.answered||{}).filter(([id,r])=>byId.has(id)&&r.fingerprint===fingerprint(byId.get(id))&&selectedIds(selectedValue(r)).length>0&&selectedIds(selectedValue(r)).every(choice=>byId.get(id).options.some(o=>o.id===choice))));
      return {...s,questionIds:ids,index:Math.max(0,ids.indexOf(current)),answered,optionOrder:Object.fromEntries(ids.map(id=>{const stored=s.optionOrder?.[id];const actual=byId.get(id).options.map(o=>o.id);return [id,Array.isArray(stored)&&stored.length===actual.length&&new Set(stored).size===actual.length&&stored.every(x=>actual.includes(x))?stored:optionIds(byId.get(id))];}))};
    }
    state.practiceSessionsByKey=Object.fromEntries(Object.values(state.practiceSessionsByKey).map(session).filter(Boolean).map(s=>[practiceKey(s),s]));
    state.practiceSession=session(state.practiceSession);
    if(state.practiceSession)state.practiceSessionsByKey[practiceKey(state.practiceSession)]=state.practiceSession;
    const exam=state.examSession;
    if(exam){
      const valid=Array.isArray(exam.questions)&&exam.questions.length>0&&Array.isArray(exam.questionIds)&&exam.questions.length===exam.questionIds.length&&
        new Set(exam.questionIds).size===exam.questionIds.length&&exam.questions.every((q,i)=>q&&q.id===exam.questionIds[i]&&['mcq','multi','tf'].includes(q.type)&&typeof q.prompt==='string'&&
          Array.isArray(q.options)&&q.options.length>=2&&q.options.every(o=>o&&typeof o.id==='string'&&typeof o.text==='string')&&(q.type==='multi'?Array.isArray(q.answerIds)&&q.answerIds.length>=2&&q.answerIds.every(id=>q.options.some(o=>o.id===id)):q.options.some(o=>o.id===q.answerId)))&&
        Number.isFinite(exam.startedAt)&&Number.isFinite(exam.deadline)&&exam.deadline>exam.startedAt&&Number.isInteger(exam.currentIndex)&&exam.currentIndex>=0&&exam.currentIndex<exam.questions.length&&
        (exam.submittedAt===null||Number.isFinite(exam.submittedAt))&&exam.answers&&typeof exam.answers==='object'&&!Array.isArray(exam.answers)&&exam.optionOrder&&
        exam.pointsByType&&exam.questions.every(q=>Number.isFinite(exam.pointsByType[q.type])&&exam.pointsByType[q.type]>0)&&Number.isFinite(exam.maxScore)&&exam.maxScore>0;
      if(!valid)state.examSession=null;
      else exam.flaggedIds=Array.isArray(exam.flaggedIds)?[...new Set(exam.flaggedIds)].filter(id=>exam.questionIds.includes(id)):[];
    }
    return state;
  }
  return {clone,defaultState,createMasteryRecord,practiceKey,fingerprint,sortByCourseware,shuffle,optionIds,prepareQuestions,examBank,addExamPreset,toggleExamFlag,createExam,scoreExam,answerStatus,selectedValue,selectedIds,correctIds,recordIncorrect,recordCorrect,finalizeExam,normalizeState};
});
