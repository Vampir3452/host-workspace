import test from 'node:test';
import assert from 'node:assert/strict';
import { sameContent } from '../lib/model.js';
test('JSONB key reordering does not create a content conflict; answers and item order do', () => {
 const local={source:{title:'Wedding',start:'2026-11-21'},body:{questions:[{id:'a',answer:'yes'}],notes:''}};
 const cloud={body:{notes:'',questions:[{answer:'yes',id:'a'}]},source:{start:'2026-11-21',title:'Wedding'}};
 assert.equal(sameContent(local,cloud),true);
 cloud.body.questions[0].answer='no'; assert.equal(sameContent(local,cloud),false);
 assert.equal(sameContent([1,2],[2,1]),false);
});
