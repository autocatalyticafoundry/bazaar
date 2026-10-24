
// Experimental-only screenshot ingestion. Browser/client uploads BYTES ONLY;
// all recognition and visual feature extraction remain server-side.
// This endpoint is disabled unless env.BAZAAR_SCREENSHOT_UPLOAD_TOKEN exists.
const BAZAAR_MAX_SCREENSHOT_BYTES=10*1024*1024;
async function bzScreenshotUploadV1(request,env){
  if(!env.BAZAAR_SCREENSHOT_UPLOAD_TOKEN) return new Response(JSON.stringify({
    ok:false,error:"upload_not_configured"
  }),{status:503,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const authorization=request.headers.get("authorization")||"";
  const expected="Bearer "+env.BAZAAR_SCREENSHOT_UPLOAD_TOKEN;
  // Avoid direct early character-by-character leaks.
  const encoder=new TextEncoder(),actual=encoder.encode(authorization),target=encoder.encode(expected);
  let diff=actual.length^target.length;
  for(let i=0;i<Math.max(actual.length,target.length);i++)
    diff|=(actual[i]||0)^(target[i]||0);
  if(diff!==0)return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{
    status:401,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const media=(request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  if(media!=="image/png")return new Response(JSON.stringify({ok:false,error:"png_required"}),{
    status:415,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const n=Number(request.headers.get("content-length")||0);
  if(n>BAZAAR_MAX_SCREENSHOT_BYTES)return new Response(JSON.stringify({ok:false,error:"image_too_large"}),{
    status:413,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const ab=await request.arrayBuffer();
  if(ab.byteLength<33||ab.byteLength>BAZAAR_MAX_SCREENSHOT_BYTES)
    return new Response(JSON.stringify({ok:false,error:"invalid_image_size"}),{
      status:413,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const bytes=new Uint8Array(ab);
  const sig=[137,80,78,71,13,10,26,10];
  if(sig.some((b,i)=>bytes[i]!==b)||String.fromCharCode(...bytes.slice(12,16))!=="IHDR")
    return new Response(JSON.stringify({ok:false,error:"invalid_png"}),{
      status:415,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const view=new DataView(ab);
  const width=view.getUint32(16),height=view.getUint32(20);
  if(width<64||height<64||width>8192||height>8192||
     width*height>24000000) return new Response(JSON.stringify({
       ok:false,error:"invalid_dimensions"
     }),{status:422,headers:{"content-type":"application/json","cache-control":"no-store"}});
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",ab)),
    x=>x.toString(16).padStart(2,"0")).join("");
  const key="perception/inputs/"+sha+".png";
  const prior=await env.BENCHMARK_R2.head(key);
  if(!prior)await env.BENCHMARK_R2.put(key,ab,{
    httpMetadata:{contentType:"image/png"},customMetadata:{
      artifact:"experimental-native-screenshot",sha256:sha,
      width:String(width),height:String(height),bytes:String(ab.byteLength)
    }});
  let recognition_status="stored_no_queue",queued_count=0;
  if(env.SCREENSHOT_QUEUE){
    const shardJobs=Array.from({length:8},(_,si)=>({
      body:{kind:"global_full_dense_rare_shortlist",
        bank_version:3,shard_index:si,input_key:key,scale:1,
        shortlist:24,pool:64,ranking:"hough",pair_mode:"rarity",
        max_bucket:48,output_key:bzExperimentShardKeyV1(sha,si)}
    }));
    await env.SCREENSHOT_QUEUE.sendBatch(shardJobs);
    recognition_status="queued";
    queued_count=shardJobs.length;
  }
  if(env.REGION_QUEUE){
    await env.REGION_QUEUE.send({kind:"fullcatalog_start_v2",input_key:key,
      output_key:bzFullConvBaseV1(key)+"error-start.json"});
    queued_count++;
    recognition_status="full_catalogue_localization_and_matching_queued";
  }
  const response={schema_version:1,ok:true,input_key:key,sha256:sha,
    width,height,bytes:ab.byteLength,previously_present:!!prior,
    recognition_status,queued_count,runtime:"Cloudflare server-side"};
  return new Response(JSON.stringify(response),{
    status:201,headers:{"content-type":"application/json","cache-control":"no-store"}});
}

function bzExperimentShardKeyV1(sha,si){
  return "debug/experimental-screenshot-v1/"+sha+"/shard-"+String(si).padStart(2,"0")+".json";
}
function bzResultHeadersV1(){return {"content-type":"application/json","cache-control":"no-store"};}
async function bzExperimentalScreenshotStatusV1(request,env,sha){
  if(!env.BAZAAR_SCREENSHOT_UPLOAD_TOKEN)return new Response(JSON.stringify({error:"upload_not_configured"}),{
    status:503,headers:bzResultHeadersV1()});
  const actual=new TextEncoder().encode(request.headers.get("authorization")||""),
    expected=new TextEncoder().encode("Bearer "+env.BAZAAR_SCREENSHOT_UPLOAD_TOKEN);
  let diff=actual.length^expected.length;
  for(let i=0;i<Math.max(actual.length,expected.length);i++)
    diff|=(actual[i]||0)^(expected[i]||0);
  if(diff!==0)return new Response(JSON.stringify({error:"unauthorized"}),{
    status:401,headers:bzResultHeadersV1()});
  if(!/^[a-f0-9]{64}$/.test(sha))return new Response(JSON.stringify({error:"invalid_sha"}),{
    status:400,headers:bzResultHeadersV1()});
  const source=await env.BENCHMARK_R2.head("perception/inputs/"+sha+".png");
  if(!source)return new Response(JSON.stringify({error:"screenshot_not_found"}),{
    status:404,headers:bzResultHeadersV1()});
  const status=[],shardKeys=[];
  for(let si=0;si<8;si++){
    const key=bzExperimentShardKeyV1(sha,si),obj=await env.BENCHMARK_R2.get(key);
    if(!obj){status.push({shard_index:si,status:"pending"});continue;}
    const v=JSON.parse(await new Response(obj.body).text());
    if(v.error)status.push({shard_index:si,status:"failed",error:v.error});
    else if(v.bank_version===3&&v.shard_index===si&&v.input_key==="perception/inputs/"+sha+".png"){
      status.push({shard_index:si,status:"completed",accepted_count:v.accepted_count});
      shardKeys.push(key);
    }else status.push({shard_index:si,status:"invalid_result"});
  }
  const allComplete=status.every(x=>x.status==="completed"),
    aggregateKey="debug/experimental-screenshot-v1/"+sha+"/aggregated.json";
  let aggregate=null;
  if(allComplete){
    const existing=await env.BENCHMARK_R2.get(aggregateKey);
    if(existing)aggregate=JSON.parse(await new Response(existing.body).text());
    else if(request.method==="POST"){
      aggregate=await glAggregateScreenV1(env,{
        shard_keys:shardKeys,output_key:aggregateKey
      });
      const saved=await env.BENCHMARK_R2.get(aggregateKey);
      aggregate=saved?JSON.parse(await new Response(saved.body).text()):aggregate;
    }
  }
  const fullcatalog=await bzFullcatalogStatusV2(env,"perception/inputs/"+sha+".png");
  const fullcatalogKey=bzFullConvBaseV1("perception/inputs/"+sha+".png")+"result.json";
  const fullcatalogObject=await env.BENCHMARK_R2.get(fullcatalogKey);
  const fullcatalogResult=fullcatalogObject?JSON.parse(await new Response(fullcatalogObject.body).text()):null;
  const regionKey=bzRegionBaseV1(sha)+"result.json";
  const regionObject=await env.BENCHMARK_R2.get(regionKey);
  const regionResult=regionObject?JSON.parse(await new Response(regionObject.body).text()):null;
  return new Response(JSON.stringify({schema_version:1,sha256:sha,
    region_result_key:regionKey,region_ready:!!regionResult,
    region_count:regionResult?.region_count||0,
    verified_region_count:regionResult?.verified_region_count||0,
    region_result:regionResult,
    fullcatalog_status:fullcatalog,fullcatalog_ready:!!fullcatalogResult,
    fullcatalog_result:fullcatalogResult,
    identity_probabilities_calibrated:false,
    input_key:"perception/inputs/"+sha+".png",all_complete:allComplete,
    complete_shards:shardKeys.length,status,
    aggregate_ready:!!aggregate,aggregate}),{
      status:(allComplete||fullcatalog.complete)?200:202,headers:bzResultHeadersV1()});
}
