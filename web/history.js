(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.L2E_HISTORY = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function hasDetails(entry) {
    return Boolean(entry && typeof entry.id === "string" && entry.id.length > 0 &&
      Number.isFinite(entry.submittedAt) && Number.isFinite(entry.score) &&
      Array.isArray(entry.questionIds) && entry.questionIds.length > 0 &&
      Array.isArray(entry.questions) && entry.questions.length === entry.questionIds.length &&
      entry.questions.every((question, index) => question && question.id === entry.questionIds[index] &&
        typeof question.prompt === "string" && (question.type==='multi'?Array.isArray(question.answerIds):typeof question.answerId === "string") &&
        Array.isArray(question.options) && question.options.length > 0 &&
        question.options.every(option => option && typeof option.id === "string" &&
          typeof option.text === "string")) &&
      entry.answers && typeof entry.answers === "object" && !Array.isArray(entry.answers));
  }

  function answerStatus(question,value) {
    if(question.type==='multi'){
      if(value==null||Array.isArray(value)&&!value.length)return 'unanswered';
      return Array.isArray(value)&&new Set(value).size===value.length&&value.length===question.answerIds.length&&question.answerIds.every(id=>value.includes(id))?'correct':'wrong';
    }
    if(!question.options.some(option=>option.id===value))return 'unanswered';
    return value===question.answerId?'correct':'wrong';
  }

  function summarize(history) {
    const attempts = (Array.isArray(history) ? history : [])
      .filter(entry => entry && Number.isFinite(entry.score) && Number.isFinite(entry.submittedAt))
      .sort((a, b) => a.submittedAt - b.submittedAt);
    const lectureMap = new Map();
    const knowledgeMap = new Map();
    let detailedCount = 0;
    let totalWrong = 0;

    for (const attempt of attempts) {
      if (!hasDetails(attempt)) continue;
      detailedCount += 1;
      for (const question of attempt.questions) {
        if (!question || !Array.isArray(question.options)) continue;
        const lectureKey = question.sourceFile || "未知课件";
        const knowledgeKey = `${lectureKey}\u0000${question.knowledgeZh || "未命名知识点"}`;
        if (!lectureMap.has(lectureKey)) {
          lectureMap.set(lectureKey, {
            label: lectureKey, sourceOrder: question.sourceOrder || 999,
            attempted: 0, wrong: 0, unanswered: 0
          });
        }
        if (!knowledgeMap.has(knowledgeKey)) {
          knowledgeMap.set(knowledgeKey, {
            source: lectureKey, knowledge: question.knowledgeZh || "未命名知识点",
            attempted: 0, wrong: 0, unanswered: 0
          });
        }
        const lecture = lectureMap.get(lectureKey);
        const knowledge = knowledgeMap.get(knowledgeKey);
        const status = answerStatus(question, attempt.answers[question.id]);
        if (status === "unanswered") {
          lecture.unanswered += 1;
          knowledge.unanswered += 1;
        } else {
          lecture.attempted += 1;
          knowledge.attempted += 1;
          if (status === "wrong") {
            lecture.wrong += 1;
            knowledge.wrong += 1;
            totalWrong += 1;
          }
        }
      }
    }

    return {
      attempts,
      detailedCount,
      totalWrong,
      lectureStats: [...lectureMap.values()].sort((a, b) => a.sourceOrder - b.sourceOrder || a.label.localeCompare(b.label)),
      knowledgeStats: [...knowledgeMap.values()].filter(item => item.wrong > 0)
        .sort((a, b) => b.wrong - a.wrong || b.wrong / b.attempted - a.wrong / a.attempted ||
          a.source.localeCompare(b.source) || a.knowledge.localeCompare(b.knowledge))
    };
  }

  function wrongQuestionsForKnowledge(history, source, knowledge) {
    const byQuestionId = new Map();
    const attempts = (Array.isArray(history) ? history : [])
      .filter(hasDetails)
      .sort((a, b) => a.submittedAt - b.submittedAt);
    for (const attempt of attempts) {
      attempt.questions.forEach((question, questionIndex) => {
        if ((question.sourceFile || "未知课件") !== source ||
          (question.knowledgeZh || "未命名知识点") !== knowledge ||
          answerStatus(question, attempt.answers[question.id]) !== "wrong") return;
        const record = byQuestionId.get(question.id) || { wrongCount: 0 };
        record.wrongCount += 1;
        record.question = question;
        record.questionIndex = questionIndex;
        record.attempt = attempt;
        byQuestionId.set(question.id, record);
      });
    }
    return [...byQuestionId.values()].sort((a, b) =>
      (a.question.sourceOrder || 999) - (b.question.sourceOrder || 999) ||
      (a.question.page || 0) - (b.question.page || 0) ||
      String(a.question.id).localeCompare(String(b.question.id))
    );
  }

  return { hasDetails, answerStatus, summarize, wrongQuestionsForKnowledge };
});
