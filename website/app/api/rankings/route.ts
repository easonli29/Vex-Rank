import { vexCollection, mapLimit } from '@/lib/vex-api';
import seasonGradeOverrides from '@/lib/season-grade-overrides.json';
import { processCompletedEvent, VCR_VERSION } from '@/lib/vcr3.mjs';
import { confidenceFor, decayedRating as computeRating } from '@/lib/vcr-scoring.mjs';

const API_ROOT='https://events.vex.com/api/v2';
const SEASONS:Record<string,{label:string;start:string;end:string}>={
  '204':{label:'2026–27 Override',start:'2026-04-01T00:00:00Z',end:'2027-06-01T00:00:00Z'},
  '197':{label:'2025–26 Push Back',start:'2025-04-01T00:00:00Z',end:'2026-06-01T00:00:00Z'},
  '190':{label:'2024–25 High Stakes',start:'2024-04-01T00:00:00Z',end:'2025-06-01T00:00:00Z'},
  '181':{label:'2023–24 Over Under',start:'2023-04-01T00:00:00Z',end:'2024-06-01T00:00:00Z'},
  '173':{label:'2022–23 Spin Up',start:'2022-04-01T00:00:00Z',end:'2023-06-01T00:00:00Z'},
};

type TeamState={id:number;number:string;rating:number;matches:number;wins:number;losses:number;ties:number;pointsFor:number;pointsAgainst:number;events:Set<number>;middleGradeEvents:Set<number>;highGradeEvents:Set<number>};

const gradeFromContext=(value:string)=>{const text=String(value??'').toLowerCase().replace(/[_/-]+/g,' ');const middle=/\bmiddle school\b|\bjunior high\b|\bjr\.? high\b|\bms\b/.test(text);const high=/\bhigh school\b|\bsenior high\b|\bhs\b/.test(text);return middle&&!high?'Middle School':high&&!middle?'High School':null};
const gradeFromOrganization=(value:string)=>/\bmiddle school\b|\bjunior high\b|\bjr\.? high\b|\bintermediate school\b|\belementary school\b/i.test(String(value??''))?'Middle School':/\bhigh school\b|\bsenior high\b|\bsecondary school\b/i.test(String(value??''))?'High School':null;
async function readCache(request:Request){try{return await (globalThis as any).caches?.default?.match(request)}catch{return undefined}}
async function writeCache(request:Request,response:Response){try{await (globalThis as any).caches?.default?.put(request,response.clone())}catch{}}

// Live/sample ranking path: only the latest 36 completed events are replayed.
// The Cloudflare entry point intercepts historical seasons and serves archives.
// A direct call to this route is therefore not a full historical-season rebuild.
export async function GET(request:Request){
  const token=process.env.ROBOT_EVENTS_API_TOKEN;
  if(!token)return Response.json({error:'RobotEvents API is not configured.'},{status:503});
  const cached=await readCache(request);if(cached)return cached;
  const headers={Authorization:`Bearer ${token}`,Accept:'application/json'};
  const requested=new URL(request.url).searchParams.get('season')??'204';const seasonId=SEASONS[requested]?requested:'204';const season=SEASONS[seasonId];
  const wallClock=new Date();const cutoff=new Date(Math.min(wallClock.getTime(),new Date(season.end).getTime()));
  const eventsUrl=`${API_ROOT}/events?season%5B%5D=${seasonId}&per_page=250`;
  try {
  const eventRows=await vexCollection(eventsUrl,headers);
  const completed=eventRows.filter(event=>event.program?.id===1&&String(event.season?.id)===seasonId&&new Date(event.end)<=cutoff&&event.divisions?.length&&!/cancell?ed/i.test(event.name)).sort((a,b)=>String(a.end).localeCompare(String(b.end))).slice(-36);
  const jobs=completed.flatMap(event=>event.divisions.map((division:any)=>({event,division})));
  const matchGroups=await mapLimit(jobs,3,async({event,division})=>{
    const data=await vexCollection(`${API_ROOT}/events/${event.id}/divisions/${division.id}/matches?round%5B%5D=2&round%5B%5D=3&round%5B%5D=4&round%5B%5D=5&round%5B%5D=6`,headers);
    return data.map(match=>({...match,eventId:event.id,gradeHint:gradeFromContext(`${event.name} ${division.name}`)}));
  });
  const matches=matchGroups.flat().filter(match=>match.alliances?.length===2&&match.alliances.every((alliance:any)=>Number.isFinite(alliance.score)&&alliance.score>=0&&alliance.teams?.length));
  const states=new Map<number,TeamState>();
  const historyByTeam=new Map<number,any[]>(),matchesByEvent=new Map<number,any[]>();for(const match of matches){if(!matchesByEvent.has(match.eventId))matchesByEvent.set(match.eventId,[]);matchesByEvent.get(match.eventId)!.push(match)}
  for(const event of completed){const eventMatches=matchesByEvent.get(event.id)??[];processCompletedEvent({event,matches:eventMatches,states,historyByTeam});for(const match of eventMatches)for(const alliance of match.alliances??[])for(const entry of alliance.teams??[]){const team=states.get(entry.team?.id);if(!team)continue;if(match.gradeHint==='Middle School')team.middleGradeEvents.add(event.id);if(match.gradeHint==='High School')team.highGradeEvents.add(event.id)}}
  // Replay uses full internal ratings; the leaderboard separately decays event
  // changes and sorts by rating minus uncertainty. Do not round before sorting.
  const rated=[...states.values()].filter(team=>team.matches>=4).map(team=>{const confidence=confidenceFor(team.matches);const history=historyByTeam.get(team.id)??[];const decayedRating=computeRating(history,cutoff);return{...team,rating:decayedRating,events:team.events.size,confidence,displayedStrength:decayedRating-confidence,form:history.slice(-5).map(row=>({event:row.event,change:row.change,tier:row.tier,champion:row.champion}))}}).sort((a,b)=>b.rating-a.rating||a.number.localeCompare(b.number));
  const groups=Array.from({length:Math.ceil(rated.length/100)},(_,index)=>rated.slice(index*100,index*100+100));
  const detailPayloads=await mapLimit(groups,3,async group=>{const ids=group.map(team=>`id%5B%5D=${team.id}`).join('&');return vexCollection(`${API_ROOT}/teams?${ids}`,headers)});
  const official=new Map(detailPayloads.flat().map(team=>[team.id,team]));
  // The fields called opr/dpr here are half-alliance scoring averages, not fitted
  // OPR/DPR estimates. Zero auto/ase/skills values are placeholders in this response.
  const rankings=rated.map((team,index)=>{const info=official.get(team.id) as any;const games=Math.max(1,team.matches);const opr=team.pointsFor/games/2;const dpr=team.pointsAgainst/games/2;const eventGrade=team.middleGradeEvents.size===team.highGradeEvents.size?null:team.middleGradeEvents.size>team.highGradeEvents.size?'Middle School':'High School';const number=info?.number??team.number;const verifiedGrade=(seasonGradeOverrides as Record<string,Record<string,string>>)[seasonId]?.[number];const grade=verifiedGrade??eventGrade??gradeFromOrganization(info?.organization)??info?.grade??'Unknown';return{rank:index+1,id:team.id,number,name:info?.team_name??info?.organization??team.number,region:[info?.location?.region,info?.location?.country].filter(Boolean).join(', ')||'Unassigned',eventRegion:info?.location?.region||info?.location?.country||'Unassigned',country:info?.location?.country||'Unassigned',rating:Math.round(team.rating),confidence:team.confidence,change:team.form.at(-1)?.change??0,record:`${team.wins}–${team.losses}–${team.ties}`,events:team.events,opr:Number(opr.toFixed(1)),dpr:Number(dpr.toFixed(1)),ccwm:Number((opr-dpr).toFixed(1)),auto:0,ase:0,consistency:Math.max(0,Math.min(100,Math.round(100-team.confidence/2))),skills:0,form:team.form,seasonId:Number(seasonId),season:season.label,matches:team.matches,grade,organization:info?.organization??'',robot:info?.robot_name??''}});
  const response=Response.json({rankings,eventsProcessed:completed.length,matchesProcessed:matches.length,method:`${VCR_VERSION} · event settlement · 75-day evidence half-life`,modelVersion:VCR_VERSION,season:season.label,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, max-age=900, s-maxage=1800, stale-while-revalidate=7200'}});
  await writeCache(request,response);return response;
  } catch { return Response.json({error:'Rankings could not be fully loaded. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}}); }
}

