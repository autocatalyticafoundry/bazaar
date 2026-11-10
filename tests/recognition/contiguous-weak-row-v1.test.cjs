// Reproduce sparse-row acceptance against six real Cloudflare R2 screenshots.
// Run: node --test tests/recognition/contiguous-weak-row-v1.test.cjs
// These are localization diagnostics, not human-verified card identities.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname,
  "../../src/recognition/region-hypotheses-v1.js"), "utf8");
const recover = runInNewContext(source + "\n bzContiguousWeakRowV1", {});

function candidate({ edges, pairs, boxes, votes, frameHeight, anchorHeight,
    anchorVotes, width = 2048 }) {
  const regions = boxes.map((bbox, i) => ({
    bbox, border_evidence: { left_x: edges[pairs[i][0]],
      right_x: edges[pairs[i][1]] }
  }));
  return { width, anchor: { medianL: anchorHeight, edge_votes: anchorVotes },
    band: { regions, medianL: frameHeight, edge_votes: votes,
      frame_edges: edges.map(x => ({x})) } };
}

const cases = [
  {
    label: "9e2daed8: adjacent two-card lower row (recover)",
    source: "debug/region-hypotheses-v1/9e2daed87a127f56896868f72a10382d7c0d2306beaadd4845e6fce1ef68b773/regions.json",
    expected: true, edges: [817,1117,1412], pairs:[[0,1],[1,2]],
    boxes: [{x:824,y:750,width:286,height:282},
      {x:1124,y:750,width:281,height:282}],
    votes:6.317, frameHeight:297, anchorHeight:297, anchorVotes:22.408
  },
  {
    label: "b51793f7: separated lower UI spans (reject)",
    expected: false, edges: [354,655,1690,1990], pairs:[[0,1],[2,3]],
    boxes: [{x:361,y:1121,width:287,height:274},
      {x:1697,y:1121,width:286,height:274}],
    votes:5.243, frameHeight:290, anchorHeight:305, anchorVotes:24.611
  },
  {
    label: "bcc15c62: separated lower UI spans (reject)",
    expected: false, edges: [385,683,1699,1999], pairs:[[0,1],[2,3]],
    boxes: [{x:392,y:1057,width:284,height:259},
      {x:1706,y:1057,width:286,height:259}],
    votes:5.628, frameHeight:274, anchorHeight:299, anchorVotes:24.611
  },
  {
    label: "cd3fa35a: separated lower UI spans (reject)",
    expected: false, edges: [373,667,1654,1948], pairs:[[0,1],[2,3]],
    boxes: [{x:380,y:1055,width:280,height:262},
      {x:1661,y:1055,width:280,height:262}],
    votes:4.703, frameHeight:277, anchorHeight:291, anchorVotes:33.87
  }
];

for (const record of cases) {
  test(record.label, () => {
    const {expected, ...fields} = record;
    const {band, anchor, width} = candidate(fields);
    assert.equal(recover(band, anchor, width), expected);
  });
}

test("the three-card anchor row is unaffected", () => {
  const {band, anchor, width} = candidate({...cases[0], pairs:[[0,1],[1,2],[0,2]],
    boxes:[...cases[0].boxes, {x:817,y:750,width:581,height:282}]});
  assert.equal(recover(band,anchor,width), false);
});

test("reject an adjacent HUD-like pair with mismatched frame height", () => {
  const {band,anchor,width} = candidate({...cases[0], frameHeight:229});
  assert.equal(recover(band,anchor,width), false);
});

test("reject an adjacent pair without enough actual edge evidence", () => {
  const {band,anchor,width} = candidate({...cases[0], votes:3});
  assert.equal(recover(band,anchor,width), false);
});
