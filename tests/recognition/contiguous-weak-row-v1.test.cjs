// R2 diagnostic fixtures for sparse, contiguous card-row recovery.
// Run node --test tests/recognition/contiguous-weak-row-v1.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const source=readFileSync(join(__dirname,
  "../../src/recognition/region-hypotheses-v1.js"),"utf8");
const recover=runInNewContext(source+"\n bzContiguousWeakSubrowV2",{});

function band({edges,pairs,boxes,votes,frameHeight,anchorHeight,anchorVotes,width=2048}){
  return { width,anchor:{medianL:anchorHeight,edge_votes:anchorVotes},
    row:{regions:boxes.map((bbox,i)=>({bbox,border_evidence:{
      left_x:edges[pairs[i][0]],right_x:edges[pairs[i][1]]}})),
    medianL:frameHeight,edge_votes:votes,frame_edges:edges.map(x=>({x}))}};
}
const cases=[
  {
    name:"Nov 10: recover two adjacent cards and omit the wide third span",
    edges:[823,1138,1428,1906],pairs:[[0,1],[1,2],[2,3]],
    boxes:[{x:830,y:754,width:301,height:279},
      {x:1145,y:754,width:276,height:279},
      {x:1435,y:754,width:464,height:279}],
    votes:5.294,frameHeight:294,anchorHeight:299,anchorVotes:14.726,
    selected:[0,1]
  },
  {
    name:"Nov 9: recover two adjacent cards",
    edges:[817,1117,1412],pairs:[[0,1],[1,2]],
    boxes:[{x:824,y:750,width:286,height:282},
      {x:1124,y:750,width:281,height:282}],
    votes:6.317,frameHeight:297,anchorHeight:297,anchorVotes:22.408,
    selected:[0,1]
  },
  {
    name:"b51793f7: reject two separated lower interface spans",
    edges:[354,655,1690,1990],pairs:[[0,1],[2,3]],
    boxes:[{x:361,y:1121,width:287,height:274},
      {x:1697,y:1121,width:286,height:274}],
    votes:5.243,frameHeight:290,anchorHeight:305,anchorVotes:24.611,selected:[]
  },
  {
    name:"bcc15c62: reject two separated lower interface spans",
    edges:[385,683,1699,1999],pairs:[[0,1],[2,3]],
    boxes:[{x:392,y:1057,width:284,height:259},
      {x:1706,y:1057,width:286,height:259}],
    votes:5.628,frameHeight:274,anchorHeight:299,anchorVotes:24.611,selected:[]
  },
  {
    name:"cd3fa35a: reject two separated lower interface spans",
    edges:[373,667,1654,1948],pairs:[[0,1],[2,3]],
    boxes:[{x:380,y:1055,width:280,height:262},
      {x:1661,y:1055,width:280,height:262}],
    votes:4.703,frameHeight:277,anchorHeight:291,anchorVotes:33.87,selected:[]
  }
];
for(const item of cases)test(item.name,()=>{
  const {row,anchor,width}=band(item);
  const selected=recover(row,anchor,width);
  assert.deepEqual(Array.from(selected,reg=>row.regions.indexOf(reg)),item.selected);
});
test("rejects frame-height mismatch",()=>{
  const {row,anchor,width}=band({...cases[0],frameHeight:229});
  assert.equal(recover(row,anchor,width).length,0);
});
test("rejects insufficient absolute edge support",()=>{
  const {row,anchor,width}=band({...cases[0],votes:3});
  assert.equal(recover(row,anchor,width).length,0);
});
test("rejects a band with only one candidate",()=>{
  const x=cases[1];const {row,anchor,width}=band({...x,
    edges:x.edges.slice(0,2),pairs:[[0,1]],boxes:x.boxes.slice(0,1)});
  assert.equal(recover(row,anchor,width).length,0);
});
test("rejects two adjacent proposals with incompatible widths",()=>{
  const x=cases[0];const {row,anchor,width}=band({...x,
    edges:[1138,1428,1906],pairs:[[0,1],[1,2]],boxes:x.boxes.slice(1)});
  assert.equal(recover(row,anchor,width).length,0);
});
