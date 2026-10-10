'use strict';

const lesson = require('../data/workshop');

function initialState() {
  return { step: 0, selectedIds: [], ingredientOK: false, visitedProcessIds: [], activeProcessIndex: 0, answerId: '', answerOK: false, completed: false, feedback: '', feedbackKind: '' };
}

function transition(state, action, value) {
  const next = Object.assign({}, state, { selectedIds: state.selectedIds.slice(), visitedProcessIds: state.visitedProcessIds.slice() });
  const feedback = (message, kind) => { next.feedback = message; next.feedbackKind = kind || 'hint'; };
  if (action === 'ingredient' && next.step === 0) {
    if (!lesson.ingredients.some(item => item.id === value)) return next;
    if (next.selectedIds.includes(value)) next.selectedIds = next.selectedIds.filter(id => id !== value);
    else if (next.selectedIds.length < 2) next.selectedIds.push(value);
    else { feedback('选两项就好。先取消一项，再换个选择。'); return next; }
    next.ingredientOK = false; feedback('');
  } else if (action === 'confirm-ingredients' && next.step === 0) {
    if (next.selectedIds.length !== 2) { feedback('请选出报道中提到的两种主要原料。'); return next; }
    if (!lesson.ingredientAnswer.every(id => next.selectedIds.includes(id))) { feedback('再想一想：名字里的“瓜”和“豆”，分别是什么？', 'retry'); return next; }
    next.ingredientOK = true; next.step = 1;
    if (!next.visitedProcessIds.includes(lesson.processes[0].id)) next.visitedProcessIds.push(lesson.processes[0].id);
    next.activeProcessIndex = 0; feedback('选对了，是西瓜和黄豆。一起看看它们经过哪些工序。', 'success');
  } else if (action === 'process' && next.step === 1) {
    if (!Number.isInteger(value) || value < 0 || value >= lesson.processes.length) return next;
    next.activeProcessIndex = value;
    if (!next.visitedProcessIds.includes(lesson.processes[value].id)) next.visitedProcessIds.push(lesson.processes[value].id);
    feedback('');
  } else if (action === 'continue' && next.step === 1) {
    const unread = lesson.processes.findIndex(item => !next.visitedProcessIds.includes(item.id));
    if (unread !== -1) {
      next.activeProcessIndex = unread; next.visitedProcessIds.push(lesson.processes[unread].id);
      feedback('翻到还没看过的“' + lesson.processes[unread].title + '”。读完后继续。');
    } else { next.step = 2; feedback(''); }
  } else if (action === 'answer' && next.step === 2) {
    if (!lesson.question.options.some(option => option.id === value)) return next;
    next.answerId = value; next.answerOK = value === lesson.question.correctId;
    feedback(next.answerOK ? '正是如此。手艺的价值，也在食材与人的连接里。' : value === 'instant' ? '还差一点。报道提到多道工序，并不是混合后就能食用。' : '文化资料讲的是手艺与生活，不能据此预测当年的销量。', next.answerOK ? 'success' : 'retry');
  } else if (action === 'complete' && next.step === 2) {
    if (!next.answerOK) { feedback('先选一个答案。可以回看工序，再试一次。'); return next; }
    next.step = 3; next.completed = true; feedback('');
  } else if (action === 'previous') {
    next.step = Math.max(0, next.step - 1); feedback('');
  }
  return next;
}

function viewState(state) {
  return Object.assign({}, state, {
    ingredientItems: lesson.ingredients.map(item => Object.assign({}, item, { selected: state.selectedIds.includes(item.id) })),
    processItems: lesson.processes.map((item, index) => ({ id: item.id, title: item.title, index, active: index === state.activeProcessIndex, visited: state.visitedProcessIds.includes(item.id) })),
    activeProcess: lesson.processes[state.activeProcessIndex],
    unreadCount: lesson.processes.length - state.visitedProcessIds.length,
    answerItems: lesson.question.options.map(item => Object.assign({}, item, { selected: state.answerId === item.id }))
  });
}

module.exports = { initialState, transition, viewState };
