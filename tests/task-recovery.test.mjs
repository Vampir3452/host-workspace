import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyBody,item,clearTaskList,restoreTaskList,replaceTemplateTasks,validatePayload} from '../lib/model.js';
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
