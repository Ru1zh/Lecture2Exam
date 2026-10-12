const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const logicPath = path.join(__dirname, '../web/logic.js');
const L = fs.existsSync(logicPath) ? require(logicPath) : {};
const question = (id, sourceId, type='mcq') => ({id,sourceId,type,sourceOrder:1,page:1,prompt:id,
  options:[{id:'a',text:'A'},{id:'b',text:'B'}],answerId:'b',explanationZh:'解析',knowledgeZh:'知识点'});
const bank = {id:'test',sources:[{id:'s1',order:1,examEligible:true},{id:'s2',order:2,examEligible:true},{id:'excluded',order:3,examEligible:false}],
  exam:{durationMinutes:15,sampling:'balanced',sections:[{type:'mcq',count:3,points:2},{type:'tf',count:2,points:1}],
  coverage:[{sourceId:'s1',minimum:{mcq:1,tf:1},maximum:{mcq:1,tf:1}},{sourceId:'s2',minimum:{mcq:1,tf:1}}]},
  mastery:{wrongThreshold:3,correctStreak:2}};
const qs = [question('a','s1'),question('b','s2'),question('c','s2'),question('d','s1','tf'),question('e','s2','tf'),question('x','excluded')];

test('named exam presets own their settings and reject empty or duplicate names',()=>{
  const settings={durationMinutes:5,groupIds:['g1'],sections:[{type:'mcq',count:1,points:2}]};
  const presets=L.addExamPreset([],'  Midterm  ',settings,'preset-1');
  settings.sections[0].points=99;assert.equal(presets[0].name,'Midterm');assert.equal(presets[0].settings.sections[0].points,2);
  assert.throws(()=>L.addExamPreset(presets,'midterm',settings,'preset-2'));
  assert.throws(()=>L.addExamPreset(presets,'   ',settings,'preset-2'));
  assert.throws(()=>L.addExamPreset(presets,'x'.repeat(81),settings,'preset-2'));
  const next=L.addExamPreset(presets,'Final',settings,'preset-2');assert.equal(presets.length,1);assert.equal(next.length,2);
});

test('review flags persist on snapshots independently of answers and never change scores',()=>{
  const exam=L.createExam(bank,qs,()=>0,1000),before=L.scoreExam(exam);
  assert.equal(L.toggleExamFlag(exam,'a'),true);assert.deepEqual(exam.flaggedIds,['a']);assert.deepEqual(L.scoreExam(exam),before);
  assert.equal(L.toggleExamFlag(exam,'missing'),false);assert.equal(L.toggleExamFlag(exam,'a'),true);assert.deepEqual(exam.flaggedIds,[]);
  L.toggleExamFlag(exam,'a');const state=L.defaultState();state.examSession={...exam,id:'flagged-exam'};
  const normalized=L.normalizeState(state,[],bank);assert.deepEqual(normalized.examSession.flaggedIds,['a']);
  L.finalizeExam(state,bank.mastery,2000);assert.deepEqual(state.examHistory[0].flaggedIds,['a']);assert.equal(L.toggleExamFlag(state.examSession,'a'),false);
  const legacy=L.clone(exam);delete legacy.flaggedIds;state.examSession={...legacy,id:'legacy'};assert.deepEqual(L.normalizeState(state,qs,bank).examSession.flaggedIds,[]);
});

test('personal exam settings select practice groups and replace default quotas without changing the bank',()=>{
  const original={...L.clone(bank),groups:[{id:'g1',label:'Lecture'},{id:'g2',label:'Tutorial'}],sources:bank.sources.map(s=>({...s,groupId:s.id==='excluded'?'g2':'g1'}))};
  const before=L.clone(original),settings={durationMinutes:12.5,groupIds:['g2'],sections:[{type:'mcq',count:1,points:2.5}]};
  const effective=L.examBank(original,settings),exam=L.createExam(effective,qs,()=>0,1000);
  assert.deepEqual(exam.questionIds,['x']);assert.equal(exam.maxScore,2.5);assert.equal(exam.deadline,751000);
  assert.deepEqual(effective.exam.coverage,[]);assert.deepEqual(original,before);assert.strictEqual(L.examBank(original,null),original);
  settings.sections[0].points=99;assert.equal(exam.pointsByType.mcq,2.5);
});

test('invalid or retired exam settings cannot silently expand the exam range',()=>{
  const original={...bank,groups:[{id:'g1',label:'Lecture'}],sources:bank.sources.map(s=>({...s,groupId:'g1'}))};
  const valid={durationMinutes:5,groupIds:['g1'],sections:[{type:'mcq',count:1,points:2}]};
  for(const invalid of [
    {...valid,durationMinutes:0},{...valid,durationMinutes:Infinity},{...valid,durationMinutes:1e307},{...valid,groupIds:[]},{...valid,groupIds:['retired']},
    {...valid,sections:[]},{...valid,sections:[{type:'mcq',count:1.5,points:2}]},{...valid,sections:[{type:'mcq',count:1,points:0}]},
    {...valid,sections:[valid.sections[0],valid.sections[0]]},{...valid,sections:[{type:'mcq',count:2,points:1e308}]}
  ])assert.throws(()=>L.examBank(original,invalid));
  const effective=L.examBank(original,{...valid,sections:[{type:'multi',count:1,points:3}]});
  assert.throws(()=>L.createExam(effective,qs),/不足/);
});

test('exam uses configured counts, coverage, exclusions, ordering, timing and snapshots',()=>{
  assert.equal(typeof L.createExam,'function');
  const exam=L.createExam(bank,qs,()=>0.25,1000);
  assert.equal(exam.questions.length,5);
  assert.deepEqual(exam.questions.map(q=>q.type),['mcq','mcq','mcq','tf','tf']);
  assert.equal(exam.questions.some(q=>q.id==='x'),false);
  assert.equal(exam.questions.filter(q=>q.type==='mcq'&&q.sourceId==='s1').length,1);
  assert.equal(exam.deadline,1000+15*60000);
  assert.equal(exam.maxScore,8);
  qs[0].prompt='edited';
  assert.equal(exam.questions.find(q=>q.id==='a').prompt,'a');
});
test('insufficient bank is rejected with an actionable error',()=>{
  assert.equal(typeof L.createExam,'function');
  assert.throws(()=>L.createExam(bank,qs.slice(0,1)),/不足|题/);
});
test('grading uses snapshot weights and counts unanswered separately',()=>{
  assert.equal(typeof L.scoreExam,'function');
  const exam=L.createExam(bank,qs,()=>0,1000);
  const score=L.scoreExam(exam,{a:'b',b:'a'});
  assert.equal(score.total,2);assert.equal(score.correct,1);assert.equal(score.incorrect,1);assert.equal(score.unanswered,3);
});
test('practice and exams share error counts and mastery requires two consecutive correct answers',()=>{
  assert.equal(typeof L.recordIncorrect,'function');
  let record=L.createMasteryRecord();
  for(let i=0;i<3;i++) record=L.recordIncorrect(record,'practice',bank.mastery);
  assert.equal(record.errorProne,true);
  record=L.recordCorrect(record,'error-prone',bank.mastery);
  record=L.recordIncorrect(record,'error-prone',bank.mastery);
  assert.equal(record.masteryStreak,0);
  record=L.recordCorrect(record,'error-prone',bank.mastery);
  record=L.recordCorrect(record,'error-prone',bank.mastery);
  assert.deepEqual(record,L.createMasteryRecord());
});
test('changing a question retires its practice answer but preserves historical snapshots',()=>{
  assert.equal(typeof L.normalizeState,'function');
  const state=L.defaultState();
  state.practiceSessionsByKey.bank={mode:'bank',questionIds:['a','retired'],index:1,answered:{a:{selectedId:'b',correct:true,fingerprint:'old'}},optionOrder:{a:['a','b']}};
  state.examHistory=[{id:'old',questions:[question('retired','s1')]}];
  const normalized=L.normalizeState(state,[question('a','s1')],bank);
  assert.deepEqual(normalized.practiceSessionsByKey.bank.questionIds,['a']);
  assert.deepEqual(normalized.practiceSessionsByKey.bank.answered,{});
  assert.equal(normalized.examHistory[0].questions[0].id,'retired');
});
test('same submitted exam does not add errors or history twice',()=>{
  assert.equal(typeof L.finalizeExam,'function');
  const state=L.defaultState();state.examSession=L.createExam(bank,qs,()=>0,1000);
  state.examSession.id='one';state.examSession.answers={a:'a'};
  L.finalizeExam(state,bank.mastery,2000);L.finalizeExam(state,bank.mastery,3000);
  assert.equal(state.masteryById.a.wrongCount,1);assert.equal(state.examHistory.length,1);
});

test('normalization rejects malformed live exams but keeps independent history',()=>{
 const state=L.defaultState();state.examSession={questionIds:['a'],currentIndex:0,startedAt:1000,deadline:2000,submittedAt:null};
 state.examHistory=[{id:'saved',score:1,submittedAt:100}];
 const normalized=L.normalizeState(state,qs,bank);
 assert.equal(normalized.examSession,null);
 assert.equal(normalized.examHistory.length,1);
});

test('multi-select grading uses exact sets and preserves snapshot scores',()=>{
 const q={...question('multi','s1','multi'),options:[{id:'a',text:'A'},{id:'b',text:'B'},{id:'c',text:'C'}],answerIds:['a','c']};delete q.answerId;
 assert.equal(L.answerStatus(q,[]),'unanswered');
 assert.equal(L.answerStatus(q,['c','a']),'correct');
 for(const answer of [['a'],['a','b','c'],['a','a','c'],['x'],'a'])assert.equal(L.answerStatus(q,answer),'wrong');
 const exam={questions:[q],answers:{multi:['c','a']},pointsByType:{multi:3}};
 assert.equal(L.scoreExam(exam).total,3);
 assert.equal(L.scoreExam(exam).multi,3);
 assert.equal(L.scoreExam({...exam,answers:{multi:['a']}}).total,0);
 assert.notEqual(L.fingerprint(q),L.fingerprint({...q,answerIds:['b','c']}));
 const sourceBank={...bank,groups:[{id:'g',label:'Group'}]};
 const s=L.defaultState();s.practiceSession={mode:'bank',questionIds:['multi'],index:0,answered:{multi:{selectedIds:['c','a'],correct:true,fingerprint:L.fingerprint(q)}},optionOrder:{multi:['a','b','c']}};
 assert.equal(L.normalizeState(s,[q],sourceBank).practiceSession.answered.multi.correct,true);
});
