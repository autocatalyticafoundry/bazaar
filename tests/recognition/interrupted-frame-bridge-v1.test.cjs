// Geometry-only fixture tests for interrupted narrow card frames.
// Run: node --test tests/recognition/interrupted-frame-bridge-v1.test.cjs
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,
  "../../src/recognition/region-hypotheses-v1.js"),"utf8");
const bridge=vm.runInNewContext(source+"\n bzInterruptedFrameBridgesV1",{});
const w=2048,h=1408;
const actual={y:717,medianL:313,frame_edges:[
  {x:463,count:3,mass:860},{x:626,count:5,mass:1428},
  {x:701,count:2,mass:305},{x:791,count:4,mass:1099},
  {x:968,count:3,mass:861}]};
const neighbor=([left,mid,right])=>({bbox:{x:0,y:725,width:right-left-14,height:298},
  border_evidence:{left_x:left,right_x:right,row_y:717,segment_height:313}});
const accepted=[neighbor([463,0,626]),neighbor([791,0,968])];
test("recovers a split frame with strong neighboring borders",()=>{
  const output=bridge(actual,accepted,w,h);
  assert.equal(output.length,1);
  assert.equal(JSON.stringify(output[0].bbox),
    JSON.stringify({x:633,y:725,width:151,height:298}));
  assert.equal(output[0].source,"interrupted_frame_bridge_v1");
});
test("rejects internal edge as strong as surrounding real borders",()=>{
  const changed={...actual,frame_edges:actual.frame_edges.map(x=>
    x.x===701?{...x,mass:1100}:x)};
  assert.equal(bridge(changed,accepted,w,h).length,0);
});
test("rejects bridge when one neighboring accepted card is absent",()=>{
  assert.equal(bridge(actual,accepted.slice(0,1),w,h).length,0);
});
test("rejects anomalously different neighboring card widths",()=>{
  const neighbors=[accepted[0],neighbor([791,0,1210])];
  assert.equal(bridge(actual,neighbors,w,h).length,0);
});
test("rejects width beyond two minimum spans",()=>{
  const altered={...actual,frame_edges:actual.frame_edges.map(x=>
    x.x===791?{...x,x:900}:x)};
  assert.equal(bridge(altered,accepted,w,h).length,0);
});
test("rejects empty bands",()=>{
  assert.equal(bridge({y:717,medianL:313,frame_edges:[]},accepted,w,h).length,0);
});
