const fs = require('fs');
const path = require('path');

const base = process.env.EVAL_BASE_URL || 'http://127.0.0.1:5010';
const out = __dirname;
const abstain = 'I could not find enough relevant information in the knowledge base to answer this question.';
const qs = [
['Q01','What is the main purpose of the NIST AI Risk Management Framework?','answerable','It helps organizations manage AI risks and promote trustworthy, responsible AI development and use.',['manage','risk','trustworthy']],
['Q02','What are the four core functions of the AI RMF?','answerable','Govern, Map, Measure, and Manage.',['govern','map','measure','manage']],
['Q03','What is the purpose of the Govern function?','answerable','It cultivates a culture of risk management and establishes policies, processes, responsibilities, and oversight across the AI lifecycle.',['culture','risk','oversight']],
['Q04','What is the purpose of the Map function?','answerable','It establishes AI-system context and identifies intended use, stakeholders, impacts, and risks.',['context','impact','risk']],
['Q05','What is the purpose of the Measure function?','answerable','It assesses, analyzes, benchmarks, and monitors AI risks and impacts using appropriate methods.',['assess','risk','monitor']],
['Q06','What is the purpose of the Manage function?','answerable','It prioritizes risks and takes actions to respond to, mitigate, or manage them.',['priorit','risk','respond']],
['Q07','Is the NIST AI RMF mandatory for every organization?','answerable','No. It is voluntary.',['voluntary']],
['Q08','Is the AI RMF designed for only one industry?','answerable','No. It is non-sector-specific and adaptable across sectors and contexts.',['sector']],
['Q09','When was AI RMF 1.0 published?','answerable','January 2023.',['january','2023']],
['Q10','Who is credited as the author of the AI RMF 1.0 publication?','answerable','Elham Tabassi.',['elham','tabassi']],
['Q11','What does the framework mean by trustworthy AI characteristics?','answerable','They are characteristics used to describe and assess AI-system trustworthiness, including validity, safety, security, accountability, explainability, privacy, and fairness.',['trust','characteristic']],
['Q12','Name the trustworthy AI characteristics discussed in the framework.','answerable','Valid and reliable; safe; secure and resilient; accountable and transparent; explainable and interpretable; privacy-enhanced; and fair with harmful bias managed.',['valid','safe','secure','account','explain','privacy','fair']],
['Q13','Does AI risk management apply only before deployment?','answerable','No. It applies throughout the AI lifecycle, including development, deployment, operation, and monitoring.',['lifecycle']],
['Q14','What types of methods can be used to measure AI risks?','answerable','Quantitative, qualitative, and mixed methods.',['quantitative','qualitative']],
['Q15','Why is testing important when assessing AI systems?','answerable','Testing, evaluation, verification, and validation assess system performance and trustworthiness and can be performed throughout the lifecycle.',['test','assess']],
['Q16','Why should AI risk measurement methods, metrics, and results be documented?','answerable','Documentation supports transparency, accountability, communication, and review of risk assessments and decisions.',['document','transparen']],
['Q17','Is Govern relevant only at the beginning of the AI lifecycle?','answerable','No. Govern is cross-cutting and informs the other functions throughout AI risk management.',['cross','function']],
['Q18','Why can involving different perspectives improve AI risk identification?','answerable','Diverse stakeholders can identify assumptions, impacts, risks, and affected groups that a narrow team may miss.',['perspective','impact']],
['Q19','What actions can an organization take when an identified AI risk is unacceptable?','answerable','It can prioritize and mitigate the risk, reassess or change the system or its use, or decide not to deploy or continue use.',['mitig','risk']],
['Q20','How do Govern, Map, Measure, and Manage work together?','answerable','Govern provides cross-cutting oversight; Map establishes context and identifies risks; Measure assesses risks; Manage prioritizes and responds.',['govern','map','measure','manage']],
['Q21','What is the current population of Pune?','insufficient_evidence',abstain,[]],
['Q22',"What was Apple's total revenue for its 2025 fiscal year?",'insufficient_evidence',abstain,[]],
['Q23','Which team won the FIFA World Cup in 2022?','insufficient_evidence',abstain,[]],
['Q24','What will the weather be in Pune tomorrow?','insufficient_evidence',abstain,[]],
['Q25','What is the current RAM usage of the computer running this application?','insufficient_evidence',abstain,[]],
['Q26','What is the current price of a specific laptop?','insufficient_evidence',abstain,[]],
['Q27','What AI regulation was announced in India this week?','insufficient_evidence',abstain,[]],
['Q28',"What is NVIDIA's current share price?",'insufficient_evidence',abstain,[]],
['Q29','Who is the principal of my college?','insufficient_evidence',abstain,[]],
['Q30','What exact score will my project evaluator award me?','insufficient_evidence',abstain,[]],
].map(([id,question,label,reference_answer,keywords])=>({id,question,label,reference_answer,keywords}));

async function ask(question) {
  const start = performance.now();
  const r = await fetch(base + '/api/chat', {method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify({question,topK:5,sourceType:'document'})});
  const text = await r.text();
  const latency_ms = Math.round(performance.now()-start);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  const events = text.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
  const done = events.find(x=>x.type==='done');
  if (!done) throw new Error('No done event');
  return {latency_ms, events, ...done};
}
function hasAbstained(a) { return /could not find enough relevant information|cannot be (?:determined|established)|not (?:provided|available) in (?:the )?(?:document|context|knowledge base)|insufficient (?:information|context|evidence)/i.test(a||''); }
function quantile(a,p) { if(!a.length)return null; const s=[...a].sort((x,y)=>x-y); const i=(s.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i); return Math.round(s[lo]+(s[hi]-s[lo])*(i-lo)); }
(async()=>{
 const results=[];
 for(const q of qs){
  try{
   const o=await ask(q.question); const answer=o.answer||''; const retrieved=o.sources||[]; const abstained=Boolean(o.insufficient)||hasAbstained(answer);
   const lower=answer.toLowerCase(); const hit=q.keywords.filter(k=>lower.includes(k)).length;
   const correctness=q.label==='answerable' ? (hit>=Math.max(1,Math.ceil(q.keywords.length*.6)) && !abstained ? 'auto_pass' : 'manual_review') : (abstained ? 'not_applicable' : 'not_applicable');
   const unsupported=q.label==='insufficient_evidence' && !abstained;
   results.push({...q,generated_response:answer,retrieved_sources:retrieved,raw_events:o.events,abstained,latency_ms:o.latency_ms,technical_failure:null,correctness,unsupported_claim:unsupported,retrieval_recall_at_5: q.label==='answerable' && retrieved.length ? 'manual_evidence_review' : 'not_applicable',citation_assessment:'no_page_citation_emitted'});
   console.log(`${q.id}: ${o.latency_ms}ms; sources=${retrieved.length}; abstained=${abstained}`);
  }catch(e){results.push({...q,generated_response:'',retrieved_sources:[],raw_events:[],abstained:false,latency_ms:null,technical_failure:String(e.message),correctness:'not_scored',unsupported_claim:null,retrieval_recall_at_5:'not_scored',citation_assessment:'not_scored'});console.error(`${q.id}: ${e.message}`)}
 }
 const answerable=results.filter(x=>x.label==='answerable'), insufficient=results.filter(x=>x.label==='insufficient_evidence'), complete=results.filter(x=>!x.technical_failure);
 const passed=answerable.filter(x=>x.correctness==='auto_pass'); const abstainOk=insufficient.filter(x=>x.abstained); const un=complete.filter(x=>x.unsupported_claim===true); const lat=complete.map(x=>x.latency_ms);
 const metrics={run_status:'completed_pending_manual_evidence_and_semantic_review',attempts:30,completed:complete.length,technical_failures:results.length-complete.length,answer_correctness:{auto_pass_count:passed.length,denominator:20,percentage:+(passed.length/20*100).toFixed(1),note:'Automated keyword screen only; manual semantic review required.'},unsupported_answer_rate:{count:un.length,denominator:complete.length,percentage:complete.length?+(un.length/complete.length*100).toFixed(1):null},abstention_accuracy:{correct_count:abstainOk.length,denominator:10,percentage:+(abstainOk.length/10*100).toFixed(1),incorrect_abstentions_on_answerable:answerable.filter(x=>x.abstained).length},retrieval_recall_at_5:{count:null,denominator:20,percentage:null,note:'Requires manual evidence review of actual top-5 chunks.'},citation_accuracy:{supported:null,total:0,percentage:null,missing_citations:complete.length,incorrect_references:0,note:'The API returns source metadata but the ingestion pipeline drops PDF page numbers; no answer-level citations are emitted.'},performance:{mean_latency_ms:lat.length?Math.round(lat.reduce((a,b)=>a+b,0)/lat.length):null,median_latency_ms:quantile(lat,.5),p95_latency_ms:quantile(lat,.95),failure_rate_percent:+((results.length-complete.length)/30*100).toFixed(1),memory_usage:'not measured reliably'},configuration:{top_k:5,threshold:null,source_filter:'document',model_temperature:0.4,num_predict:1000}};
 fs.writeFileSync(path.join(out,'raw_outputs.json'),JSON.stringify({run_config:metrics.configuration,results},null,2));
 fs.writeFileSync(path.join(out,'metrics_summary.json'),JSON.stringify(metrics,null,2));
 const cols=['id','label','question','reference_answer','generated_response','retrieved_sources','abstained','latency_ms','technical_failure','correctness','unsupported_claim','retrieval_recall_at_5','citation_assessment'];
 const esc=x=>'"'+String(x??'').replaceAll('"','""')+'"'; fs.writeFileSync(path.join(out,'question_results.csv'),cols.join(',')+'\n'+results.map(r=>cols.map(c=>esc(typeof r[c]==='object'?JSON.stringify(r[c]):r[c])).join(',')).join('\n')+'\n');
})();
