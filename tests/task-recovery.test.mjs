import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyBody,item,clearTaskList,restoreTaskList,clearQuestionList,restoreQuestionList,discardRecoveredItems,replaceTemplateTasks,validatePayload} from '../lib/model.js';
test('discarding a recovery list preserves current data and the other recovery list',()=>{
 const body={...emptyBody(),notes:'Notes',tasks:[item('Current')],tasksRecovery:[item('Old task')],questionsRecovery:[{...item('Old question'),answer:'Answer'}]};
 const next=discardRecoveredItems(body,'tasks');assert.equal(next.tasksRecovery,undefined);assert.deepEqual(next.tasks,body.tasks);assert.deepEqual(next.questionsRecovery,body.questionsRecovery);assert.equal(body.tasksRecovery.length,1);
 assert.equal(discardRecoveredItems(next,'questions').questionsRecovery,undefined);assert.throws(()=>discardRecoveredItems(body,'notes'));
});
test('discussion clearing and recovery preserve answers, comments and all other event materials',()=>{
 const body={...emptyBody(),notes:'Notes',questionnaires:'Forms',tasks:[item('Task')],questions:[{...item('Question'),answer:'Saved answer',comment:'Saved comment',done:true}]};
 const cleared=clearQuestionList(body);assert.equal(cleared.questions.length,0);assert.equal(body.questions.length,1);
 const restored=restoreQuestionList(cleared);assert.deepEqual(restored,body);
 assert.equal(validatePayload('event',{source:{googleId:'a',title:'A',start:'2026-11-21',status:'confirmed'},body:cleared}),true);
 cleared.questions.push(item('New'));assert.equal(restoreQuestionList(cleared).questions.length,2);
});
test('clearing and restoring tasks preserves notes, answers, annotations and completed task details',()=>{
 const body={...emptyBody(),notes:'Keep',questionnaires:'Keep too',questions:[{...item('Question'),answer:'Answer'}],tasks:[{...item('Task'),done:true,comment:'Detail'}]};
 const cleared=clearTaskList(body); assert.equal(cleared.tasks.length,0);assert.equal(cleared.questions[0].answer,'Answer');assert.equal(body.tasks.length,1);
 const restored=restoreTaskList(cleared);assert.deepEqual(restored.tasks,body.tasks);assert.equal(restored.notes,'Keep');assert.equal(restored.questionnaires,'Keep too');
 assert.equal(restored.tasksRecovery,undefined);assert.equal(validatePayload('event',{source:{googleId:'a',title:'A',start:'2026-11-21',status:'confirmed'},body:cleared}),true);
});
test('task template replacement avoids duplicate questions and retains recoverable earlier tasks',()=>{
 const body={...emptyBody(),questions:[{...item('Question'),answer:'Saved'}],tasks:[item('Old')]};
 const next=replaceTemplateTasks(body,{id:'template:a',category:'wedding',tasks:[item('New')]});
 assert.equal(next.questions.length,1);assert.equal(next.questions[0].answer,'Saved');assert.equal(next.tasks.length,1);assert.equal(next.tasks[0].label,'New');
 const restored=restoreTaskList(next);assert.deepEqual(restored.tasks.map(x=>x.label),['New','Old']);
});
