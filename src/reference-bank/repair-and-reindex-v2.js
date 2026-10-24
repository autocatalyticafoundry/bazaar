
// Repair previously failed normalized references into a versioned bank/index.
// All writes stay under v2 prefixes; v1 packed geometry baseline is untouched.
const GL_REPAIR_V2_PREFIX="debug/whole-screen-local-feature-bank-v2/";
const GL_INDEX_V2_PREFIX="debug/global-local-packed-index-v2/";
function glRepairBatchKeyV2(start){return GL_REPAIR_V2_PREFIX+"repair-"+String(start).padStart(2,"0")+".json";}
async function glRepairBatchV2(env,body){
  const start=Math.max(0,Math.min(25,Number(body.start)||0));
  const count=Math.max(1,Math.min(4,Number(body.count)||4));
  const baseline=await env.BENCHMARK_R2.get("debug/whole-screen-local-feature-bank-v1/bank.json");
  if(!baseline)throw new Error("v1 reference bank missing");
  const v1=JSON.parse(await new Response(baseline.body).text()),failures=v1.failures||[];
  if(v1.failure_count!==26||failures.length!==26)throw new Error("unexpected repair manifest");
  const rows=[],errors=[];
  for(const fail of failures.slice(start,start+count)){
    const sha=String(fail.error||"").match(/\b[a-f0-9]{64}\b/)?.[0];
    if(!sha){errors.push({asset_path:fail.asset_path,error:"SHA unavailable"});continue;}
    try {
      const ref=await lgReference(env,sha);
      rows.push({asset_path:fail.asset_path,source_sha256:sha,width:ref.width,
        height:ref.height,features:ref.features.map(f=>[f.x,f.y,lgDescToB64(f.descriptor)])});
    }catch(e){errors.push({asset_path:fail.asset_path,error:String(e)});}
  }
  const key=glRepairBatchKeyV2(start);
  const report={schema_version:1,repair_version:"v2",start,count,rows,
    built:rows.length,errors,failed:errors.length};
  await env.BENCHMARK_R2.put(key,JSON.stringify(report),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"bank-repair-v2",built:String(rows.length),failed:String(errors.length)}});
  return {key,built:rows.length,errors};
}
async function glAssembleBankV2(env){
  const base="debug/whole-screen-local-feature-bank-v1/bank.json";
  const o=await env.BENCHMARK_R2.get(base);
  if(!o)throw new Error("baseline bank unavailable");
  const v1=JSON.parse(await new Response(o.body).text());
  const all=[...v1.rows],seen=new Set(all.map(r=>r.asset_path));
  for(let start=0;start<26;start+=4){
    const key=glRepairBatchKeyV2(start),r=await env.BENCHMARK_R2.get(key);
    if(!r)throw new Error("missing repair part "+key);
    const p=JSON.parse(await new Response(r.body).text());
    if(p.failed||!p.rows?.length)throw new Error("failed repair part "+key);
    for(const row of p.rows){if(seen.has(row.asset_path))throw new Error("duplicate "+row.asset_path);
      seen.add(row.asset_path);all.push(row);}
  }
  const manifest=await lgItemSnapshotRows(env);
  const expected=new Map(manifest.map((r,i)=>[r.asset_path,{sha:r.source_sha256,index:i}]));
  if(expected.size!==1483||all.length!==1483)throw new Error("reference count mismatch "+expected.size+"/"+all.length);
  for(const row of all) {
    const known=expected.get(row.asset_path);
    if(!known||known.sha!==row.source_sha256)throw new Error("catalogue identity/hash mismatch "+row.asset_path);
    if(!row.features?.length||row.features.length>256)throw new Error("invalid features "+row.asset_path);
  }
  all.sort((a,b)=>expected.get(a.asset_path).index-expected.get(b.asset_path).index);
  const writes=[];
  // Shards are individually read by Workers. No RANSAC thresholds or v1 source changes.
  for(let si=0;si<8;si++){
    const rows=all.slice(si*192,(si+1)*192),key=GL_REPAIR_V2_PREFIX+"shards/shard-"+String(si).padStart(2,"0")+".json";
    if(!rows.length)throw new Error("empty shard");
    await env.BENCHMARK_R2.put(key,JSON.stringify({
      schema_version:1,bank_version:"whole-screen-local-feature-bank-v2",shard_index:si,
      reference_count:rows.length,start_reference:si*192,rows
    }),{httpMetadata:{contentType:"application/json"},customMetadata:{artifact:"whole-screen-local-feature-bank-v2",reference_count:String(rows.length),shard:String(si)}});
    writes.push({key,reference_count:rows.length});
  }
  const result={schema_version:1,bank_version:"whole-screen-local-feature-bank-v2",
    baseline_count:v1.reference_count,repaired_count:26,reference_count:all.length,
    failure_count:0,catalogue_count:expected.size,shards:writes,
    source_bank_key:base,rows:all};
  const key=GL_REPAIR_V2_PREFIX+"bank.json";
  await env.BENCHMARK_R2.put(key,JSON.stringify(result),{
    httpMetadata:{contentType:"application/json"},
    customMetadata:{artifact:"whole-screen-local-feature-bank-v2",reference_count:String(all.length),failure_count:"0"}});
  return {key,reference_count:all.length,repaired_count:26,shards:writes};
}
async function glBuildPackedIndexV2(env,body){
  const si=Math.max(0,Math.min(7,Number(body.shard_index)||0));
  const bank=await lgLoadBank(env,GL_REPAIR_V2_PREFIX+"shards/shard-"+String(si).padStart(2,"0")+".json");
  const refs=bank.refs,offs=[0,2,4,6,8,10,12,14],counts=new Uint32Array(8*65536);
  if(!refs.length||refs.length>192)throw new Error("invalid v2 shard size");
  let featureCount=0;
  for(let ri=0;ri<refs.length;ri++)for(let fi=0;fi<refs[ri].features.length;fi++){
    if(fi>=256)throw new Error("feature ID overflow");
    featureCount++;const d=refs[ri].features[fi].descriptor;
    for(let ci=0;ci<8;ci++)counts[ci*65536+(d[offs[ci]]<<8)+d[offs[ci]+1]]++;
  }
  const heads=new Uint32Array(8*65537);
  let total=0;
  for(let ci=0;ci<8;ci++){const hb=ci*65537,cb=ci*65536;heads[hb]=total;
    for(let v=0;v<65536;v++){total+=counts[cb+v];heads[hb+v+1]=total;}}
  const codes=new Uint32Array(total),cursor=new Uint32Array(8*65536);
  for(let ci=0;ci<8;ci++){const hb=ci*65537,cb=ci*65536;
    for(let v=0;v<65536;v++)cursor[cb+v]=heads[hb+v];}
  for(let ri=0;ri<refs.length;ri++)for(let fi=0;fi<refs[ri].features.length;fi++){
    const d=refs[ri].features[fi].descriptor,code=ri*256+fi;
    for(let ci=0;ci<8;ci++){const k=ci*65536+(d[offs[ci]]<<8)+d[offs[ci]+1];
      codes[cursor[k]++]=code;}
  }
  if(total!==featureCount*8)throw new Error("packed code count mismatch");
  const buf=new ArrayBuffer(16+heads.byteLength+codes.byteLength),hdr=new Uint32Array(buf,0,4);
  hdr[0]=0x42495831;hdr[1]=refs.length;hdr[2]=codes.length;hdr[3]=heads.length;
  new Uint32Array(buf,16,heads.length).set(heads);
  new Uint32Array(buf,16+heads.byteLength,codes.length).set(codes);
  const key=GL_INDEX_V2_PREFIX+"shard-"+String(si).padStart(2,"0")+".bin";
  await env.BENCHMARK_R2.put(key,buf,{
    httpMetadata:{contentType:"application/octet-stream"},
    customMetadata:{artifact:"global-local-packed-index-v2",reference_count:String(refs.length),
      feature_count:String(featureCount),index_entries:String(total)}});
  return {key,shard_index:si,reference_count:refs.length,feature_count:featureCount,index_entries:total,bytes:buf.byteLength};
}
const glPackedV2Cache=new Map();
async function glLoadPackedIndexV2(env,si){
  if(glPackedV2Cache.has(si))return glPackedV2Cache.get(si);
  const promise=(async()=>{
    const key=GL_INDEX_V2_PREFIX+"shard-"+String(si).padStart(2,"0")+".bin";
    const obj=await env.BENCHMARK_R2.get(key);
    if(!obj)throw new Error("missing packed index v2 "+si);
    const buf=await new Response(obj.body).arrayBuffer(),hdr=new Uint32Array(buf,0,4);
    if(hdr[0]!==0x42495831||hdr[3]!==8*65537)throw new Error("bad packed v2 index "+si);
    const heads=new Uint32Array(buf,16,hdr[3]),codes=new Uint32Array(buf,16+hdr[3]*4,hdr[2]);
    return {reference_count:hdr[1],heads,codes,offs:[0,2,4,6,8,10,12,14]};
  })();
  glPackedV2Cache.set(si,promise);
  return promise.catch(e=>{glPackedV2Cache.delete(si);throw e;});
}
