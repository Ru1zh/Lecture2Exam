const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),L=require('../web/logic.js');
const sample=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/multi-format.json'),'utf8'));
test('generic sample supports three question types, source coverage and configured scoring',()=>{
 const questions=L.prepareQuestions(sample.bank,sample.questions);assert.equal(questions.length,8);
 for(let i=0;i<20;i++){
  const bank=L.clone(sample.bank);bank.exam.coverage=[{sourceId:'s0',minimum:{mcq:1,tf:1}}];
  const exam=L.createExam(bank,questions);assert.equal(exam.questions.length,5);assert.equal(exam.maxScore,9);
  assert.deepEqual(exam.questions.map(q=>q.type),['mcq','mcq','multi','tf','tf']);
  const answers=Object.fromEntries(exam.questions.map(q=>[q.id,q.type==='multi'?[...q.answerIds].reverse():q.answerId]));assert.equal(L.scoreExam(exam,answers).total,9);
  assert.equal(exam.questions.filter(q=>q.sourceId==='s0').length>=2,true);
 }
});
test('active exam preserves its questions and scoring after current bank changes',()=>{
 const bank=L.clone(sample.bank),state=L.defaultState();state.examSession=L.createExam(bank,L.prepareQuestions(bank,sample.questions),()=>.1,1000);state.examSession.id='active';
 const q=state.examSession.questions[0];state.examSession.answers[q.id]=q.answerId;bank.exam.sections[0].points=10;
 const restored=L.normalizeState(state,[],bank);assert.equal(restored.examSession.questions.length,5);L.finalizeExam(restored,bank.mastery,2000);assert.equal(restored.examHistory[0].score,2);assert.equal(restored.examHistory[0].maxScore,9);
});
