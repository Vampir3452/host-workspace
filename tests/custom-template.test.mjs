import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplate, validatePayload, applyTemplate, emptyBody } from '../lib/model.js';
test('custom templates have independent identities, valid payloads and fresh copies',()=>{
 const a=createTemplate('  My template  ','other'),b=createTemplate('My template','wedding');
 assert.notEqual(a.id,b.id);assert.equal(a.payload.name,'My template'); assert.equal(validatePayload('template',a.payload),true);
 a.payload.tasks.push({id:'a',label:'Task',answer:'',comment:'',done:true});
 const copy=applyTemplate(emptyBody(),{...a.payload,id:a.id}); assert.equal(copy.tasks[0].done,false);assert.notEqual(copy.tasks[0].id,'a');
 assert.throws(()=>createTemplate(' '));assert.throws(()=>createTemplate('A','invalid'));
});
test('event backup accepts formatting while requiring a plain text fallback',()=>{
 const payload={source:{googleId:'a',title:'Test',start:'2026-11-21',status:'confirmed'},body:emptyBody()};
 payload.body.notes='Note';payload.body.notesHtml='<b>Note</b>';assert.equal(validatePayload('event',payload),true);
 payload.body.notesHtml={bad:true};assert.equal(validatePayload('event',payload),false);
 payload.body.notesHtml='<b>Note</b>';payload.body.questionnaires='Bride\nGroom';assert.equal(validatePayload('event',payload),true);
 payload.body.questionnaires={};assert.equal(validatePayload('event',payload),false);
});
