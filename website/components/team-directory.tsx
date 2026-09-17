'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowUpRight } from 'lucide-react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { siteFetch } from '@/lib/client-fetch';
import { directoryLocations, normalizeCountry, searchDirectory } from '@/lib/team-directory.mjs';

type Team={id:number;number:string;name:string;organization:string;country:string;region:string;city:string;grade:string;registered:boolean};
type Directory={teams:Team[];asOf:string;total:number};
let directoryRequest:Promise<Directory>|null=null;
function loadDirectory(){
  if(!directoryRequest)directoryRequest=siteFetch('/api/team-directory',{signal:AbortSignal.timeout(60000)})
    .then(async response=>{if(!response.ok)throw new Error('The team directory could not be loaded. Please retry.');const data=await response.json();if(!Array.isArray(data.teams)||data.teams.length!==data.total)throw new Error('The team directory is incomplete. Please retry.');return data;})
    .catch(error=>{directoryRequest=null;throw error;});
  return directoryRequest;
}
export default function TeamDirectory({search,setSearch,country,setCountry,region,setRegion,grade,setGrade,openTeam}:any){
  const [directory,setDirectory]=useState<Directory|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[limit,setLimit]=useState(60);
  useEffect(()=>{let active=true;setError('');loadDirectory().then(data=>{if(active)setDirectory(data)}).catch(()=>{if(active)setError('The team directory could not be loaded. Please retry.')});return()=>{active=false}},[retry]);
  const teams=directory?.teams??[];
  const selectedCountry=country==='All'?'All':normalizeCountry(country);
  const selectedGrade=['Middle School','High School'].includes(grade)?grade:'All';
  const locations=useMemo(()=>directoryLocations(teams,selectedCountry),[teams,selectedCountry]);
  const results=useMemo(()=>searchDirectory(teams,search,{country:selectedCountry,region,grade:selectedGrade}),[teams,search,selectedCountry,region,selectedGrade]);
  useEffect(()=>setLimit(60),[search,selectedCountry,region,selectedGrade]);
  const selectClass='w-full [&_select]:h-10 [&_select]:rounded-none [&_select]:border-white/10 [&_select]:bg-black/20';
  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8">
    <p className="text-xs font-black uppercase tracking-[.18em] text-[var(--c-accent)]">Team directory</p>
    <h1 className="mt-3 text-4xl font-black tracking-[-.04em] sm:text-5xl">Find any V5RC team</h1>
    <p className="mt-4 text-sm text-white/50">Search a team number, part of a number, name or organization. Includes currently registered and historical teams.</p>
    <div className="mt-8 grid gap-3 border border-white/10 bg-[var(--c-surface)] p-4 sm:grid-cols-3 xl:grid-cols-[2fr_1fr_1fr_1fr]">
      <label className="relative sm:col-span-3 xl:col-span-1"><Search className="absolute left-3 top-3 h-4 w-4 text-white/50"/><input aria-label="Search team directory" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Try 8829C or 55288A" className="h-10 w-full border border-white/10 bg-black/20 pl-9 pr-3 text-sm outline-none focus:border-white/30"/></label>
      <NativeSelect aria-label="Team country" value={selectedCountry} onChange={e=>{setCountry(e.target.value);setRegion('All')}} className={selectClass}><NativeSelectOption value="All">All countries</NativeSelectOption>{locations.countries.map((c:string)=><NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Team region" value={region} onChange={e=>setRegion(e.target.value)} className={selectClass}><NativeSelectOption value="All">All regions</NativeSelectOption>{locations.regions.map((r:string)=><NativeSelectOption key={r} value={r}>{r}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Team grade" value={selectedGrade} onChange={e=>setGrade(e.target.value)} className={selectClass}><NativeSelectOption value="All">All school levels</NativeSelectOption><NativeSelectOption value="Middle School">Middle School</NativeSelectOption><NativeSelectOption value="High School">High School</NativeSelectOption></NativeSelect>
    </div>
    {error?<div role="alert" className="mt-5 border border-rose-400/30 p-5 text-sm text-rose-300">{error}<button onClick={()=>setRetry(n=>n+1)} className="ml-4 border border-white/20 px-3 py-2 text-white">Retry</button></div>:!directory?<p role="status" className="mt-5 text-sm text-white/50">Loading the team directory…</p>:<>
      <p role="status" className="mt-5 text-sm text-white/55">{results.length.toLocaleString()} teams found · Directory updated {new Date(directory.asOf).toLocaleDateString()}</p>
      <p className="mt-2 text-xs text-white/55">School level and location reflect each team’s latest official profile, including inactive teams.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{results.slice(0,limit).map((t:Team)=><button key={t.id} onClick={()=>openTeam({...t,region:[t.city,t.region,t.country].filter(v=>v&&v!=='Unassigned').join(', ')})} className="float-card group border border-white/10 bg-[var(--c-surface)] p-5 text-left hover:border-white/30">
        <div className="flex items-center justify-between"><h2 className="text-xl font-black group-hover:text-[var(--c-accent)]">{t.number}</h2><ArrowUpRight className="h-4 w-4 text-white/50"/></div>
        <p className="mt-2 text-sm text-white/80">{t.name}</p>{t.organization&&t.organization!==t.name&&<p className="mt-1 text-sm text-white/45">{t.organization}</p>}
        <p className="mt-4 text-sm text-white/50">{[t.city,t.region,t.country].filter(v=>v&&v!=='Unassigned').join(', ')||'Location unavailable'}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/55"><span>{t.grade}</span><span>·</span><span>{t.registered?'Currently registered':'Not currently registered'}</span></div>
      </button>)}</div>
      {!results.length&&<p className="mt-5 border border-dashed border-white/15 p-10 text-center text-sm text-white/50">No teams match this search and these filters.</p>}
      {results.length>limit&&<button onClick={()=>setLimit(n=>n+60)} className="mt-5 w-full border border-white/15 py-3 text-sm font-bold">Show more teams · {results.length-limit} remaining</button>}
    </>}
  </section>;
}

