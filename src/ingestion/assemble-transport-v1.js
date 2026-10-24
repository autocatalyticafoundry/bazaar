
// Reassemble exact screenshot bytes transferred through the connector into R2.
// This is strictly server-side and verifies the full-file SHA before saving.
async function bzAssembleTransportV1(env,body){
  const sha=String(body.sha256||"").toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(sha))throw new Error("invalid expected sha256");
  const num=Math.floor(Number(body.part_count));
  if(num<1||num>96)throw new Error("invalid part_count");
  const expected=Math.floor(Number(body.expected_bytes));
  if(expected<33||expected>10*1024*1024)throw new Error("invalid byte count");
  const prefix="debug/experimental-screenshot-v1/"+sha+"/";
  const resultKey=prefix+"assembly.json";
  const chunks=[];
  let len=0;
  for(let i=0;i<num;i++){
    const key=prefix+"transport-"+String(i).padStart(2,"0")+".bin";
    const obj=await env.BENCHMARK_R2.get(key);
    if(!obj)throw new Error("missing transfer chunk "+i);
    const bytes=new Uint8Array(await obj.arrayBuffer());
    if(!bytes.length)throw new Error("zero-sized transport chunk "+i);
    chunks.push(bytes);len+=bytes.length;
    if(len>expected)throw new Error("transfer oversized");
  }
  if(len!==expected)throw new Error("transfer length mismatch: "+len+" != "+expected);
  const full=new Uint8Array(len);
  let off=0;
  for(const bytes of chunks){full.set(bytes,off);off+=bytes.length;}
  const png=[137,80,78,71,13,10,26,10];
  if(png.some((v,i)=>full[i]!==v)||String.fromCharCode(...full.slice(12,16))!=="IHDR")
    throw new Error("reassembled bytes not PNG");
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",full)),
      n=>n.toString(16).padStart(2,"0")).join("");
  if(hash!==sha)throw new Error("SHA-256 checksum mismatch");
  const key="perception/inputs/"+sha+".png";
  await env.BENCHMARK_R2.put(key,full,{
    httpMetadata:{contentType:"image/png"},
    customMetadata:{artifact:"native-screenshot-exact-original",sha256:hash,
      bytes:String(len),part_count:String(num)}
  });
  const data={schema_version:1,sha256:hash,bytes:len,
    width:new DataView(full.buffer).getUint32(16),
    height:new DataView(full.buffer).getUint32(20),
    part_count:num,verified:true,input_key:key,
    assembled_at:new Date().toISOString()};
  await env.BENCHMARK_R2.put(resultKey,JSON.stringify(data),{
    httpMetadata:{contentType:"application/json"}
  });
  return data;
}
