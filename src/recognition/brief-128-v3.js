
// Descriptor v3: 128 independent deterministic BRIEF pixel tests.
// Descriptor geometry is rebuilt from canonical pixels at the same native
// keypoint coordinates as v2. No screenshot-specific visual rule is involved.
function glV3Mix32(x) {
  x^=x>>>16;x=Math.imul(x,0x7feb352d);
  x^=x>>>15;x=Math.imul(x,0x846ca68b);
  return (x^(x>>>16))>>>0;
}
const GL_V3_PAIRS=(()=>{
  const pairs=[],seen=new Set();
  for(let nonce=0;nonce<10000&&pairs.length<128;nonce++){
    const a=glV3Mix32((nonce*4+1+0x13579bdf)>>>0),
      b=glV3Mix32((nonce*4+3+0x2468ace0)>>>0);
    const ax=a%17-8,ay=(a>>>8)%17-8,bx=b%17-8,by=(b>>>8)%17-8;
    if((ax-bx)**2+(ay-by)**2<16)continue;
    const p=[ax,ay,bx,by],forward=p.join(","),reverse=[bx,by,ax,ay].join(",");
    if(seen.has(forward)||seen.has(reverse))continue;
    pairs.push(p);seen.add(forward);seen.add(reverse);
  }
  if(pairs.length!==128)throw new Error("v3 descriptor cannot generate 128 unique tests");
  return pairs;
})();
function glRedescribeV3(data,w,h,features,scale=1) {
  const gray=new Float32Array(w*h);
  for(let p=0;p<gray.length;p++){const o=p*4;gray[p]=lgGray(data[o],data[o+1],data[o+2]);}
  return features.map(f=>{
    const d=new Uint8Array(16);
    for(let bit=0;bit<128;bit++){
      const [u,v,s,t]=GL_V3_PAIRS[bit],ax=Math.round(u*scale),ay=Math.round(v*scale),
        bx=Math.round(s*scale),by=Math.round(t*scale);
      if(lgPatchMean(gray,w,h,f.x+ax,f.y+ay)<lgPatchMean(gray,w,h,f.x+bx,f.y+by))
        d[bit>>>3]|=1<<(bit&7);
    }
    return {x:f.x,y:f.y,descriptor:d};
  });
}
const GL_V3_BANK="debug/whole-screen-local-feature-bank-v3/";
function glV3PartKey(si,start){
  return GL_V3_BANK+"parts/s"+String(si).padStart(2,"0")+"-p"+String(start).padStart(3,"0")+".json";
}
async function glV3BankPart(env,body) {
  const si=Math.max(0,Math.min(7,Number(body.shard_index)||0)),
    start=Math.max(0,Math.min(191,Number(body.start)||0)),
    count=Math.max(1,Math.min(12,Number(body.count)||12)),
    key="debug/whole-screen-local-feature-bank-v2/shards/shard-"+String(si).padStart(2,"0")+".json";
  const obj=await env.BENCHMARK_R2.get(key);
  if(!obj)throw new Error("v2 shard missing");
  const shard=JSON.parse(await new Response(obj.body).text()),rows=[],errors=[];
  for(const row of shard.rows.slice(start,start+count)){
    try{
      const normalized=await env.BENCHMARK_R2.get("catalogue/item-visual-normalized-v1/"+row.source_sha256+".png");
      if(!normalized)throw new Error("normalized reference missing");
      const png=await decodePng(await new Response(normalized.body).arrayBuffer()),
        im=lgBoundReferenceImage(png,320);
      if(im.width!==row.width||im.height!==row.height)throw new Error("canonical dimension mismatch");
      const original=row.features.map(f=>({x:f[0],y:f[1]})),
        features=glRedescribeV3(im.rgba,im.width,im.height,original,1);
      rows.push({...row,features:features.map(f=>[f.x,f.y,lgDescToB64(f.descriptor)])});
    }catch(e){errors.push({asset_path:row.asset_path,error:String(e)});}
  }
  const report={schema_version:1,descriptor_version:"brief128-v3",shard_index:si,start,
    attempted:Math.min(count,shard.rows.length-start),built:rows.length,errors,rows};
  const out=glV3PartKey(si,start);
  await env.BENCHMARK_R2.put(out,JSON.stringify(report),{httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"brief128-v3-bank-part",built:String(rows.length),errors:String(errors.length)}});
  return {key:out,attempted:report.attempted,built:report.built,errors};
}
async function glV3AssembleShard(env,body) {
  const si=Math.max(0,Math.min(7,Number(body.shard_index)||0)),
    source="debug/whole-screen-local-feature-bank-v2/shards/shard-"+String(si).padStart(2,"0")+".json";
  const obj=await env.BENCHMARK_R2.get(source);
  if(!obj)throw new Error("v2 bank shard missing "+si);
  const old=JSON.parse(await new Response(obj.body).text());
  const rows=[];
  for(let start=0;start<old.rows.length;start+=12) {
    const key=glV3PartKey(si,start),o=await env.BENCHMARK_R2.get(key);
    if(!o)throw new Error("missing descriptor v3 batch "+key);
    const batch=JSON.parse(await new Response(o.body).text());
    if(batch.errors.length||batch.built!==batch.attempted)throw new Error("incomplete batch "+key);
    rows.push(...batch.rows);
  }
  if(rows.length!==old.rows.length)throw new Error("v3 shard count mismatch");
  for(let i=0;i<rows.length;i++)if(rows[i].asset_path!==old.rows[i].asset_path||
      rows[i].source_sha256!==old.rows[i].source_sha256||
      rows[i].features.length!==old.rows[i].features.length)
    throw new Error("v3 shard identity/keypoint mismatch "+i);
  const result={schema_version:1,bank_version:"whole-screen-local-feature-bank-v3",
    descriptor_version:"brief128-v3",shard_index:si,reference_count:rows.length,
    start_reference:si*192,rows};
  const out=GL_V3_BANK+"shards/shard-"+String(si).padStart(2,"0")+".json";
  await env.BENCHMARK_R2.put(out,JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"whole-screen-local-feature-bank-v3",reference_count:String(rows.length),
      descriptor_version:"brief128-v3"}});
  return {key:out,reference_count:rows.length};
}
async function glV3AssembleBank(env) {
  const rows=[],shards=[];
  for(let si=0;si<8;si++){
    const key=GL_V3_BANK+"shards/shard-"+String(si).padStart(2,"0")+".json",
      o=await env.BENCHMARK_R2.get(key);
    if(!o)throw new Error("missing v3 bank shard "+si);
    const s=JSON.parse(await new Response(o.body).text());
    if(s.descriptor_version!=="brief128-v3")throw new Error("wrong descriptor version");
    rows.push(...s.rows);shards.push({key,reference_count:s.rows.length});
  }
  if(rows.length!==1483||new Set(rows.map(r=>r.asset_path)).size!==1483)
    throw new Error("v3 complete bank count/uniqueness mismatch");
  const result={schema_version:1,bank_version:"whole-screen-local-feature-bank-v3",
    descriptor_version:"brief128-v3",reference_count:rows.length,failure_count:0,shards,rows};
  const out=GL_V3_BANK+"bank.json";
  await env.BENCHMARK_R2.put(out,JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"whole-screen-local-feature-bank-v3",reference_count:"1483",
      failure_count:"0",descriptor_version:"brief128-v3"}});
  return {key:out,reference_count:rows.length,shards};
}
async function glV3Screenshot(env,inputKey,ds) {
  const loaded=await loadProofInputs(env,inputKey),im=loaded.image,
    positions=lgExtractSpatialFastGrid(im.rgba,im.width,im.height,16,12,32,2,ds),
    features=glRedescribeV3(im.rgba,im.width,im.height,positions,ds);
  return {width:im.width,height:im.height,descriptor_scale:ds,
    descriptor_version:"brief128-v3",features};
}
