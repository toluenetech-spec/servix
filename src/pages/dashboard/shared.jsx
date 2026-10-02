import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon.jsx';
import { PageSkeleton } from '../../components/ui/States.jsx';
export function useResource(load, dependencies=[]) {
  const [data,setData]=useState(null),[error,setError]=useState(null),[version,setVersion]=useState(0);
  useEffect(()=>{let alive=true;setData(null);setError(null);Promise.resolve().then(load).then(value=>{if(alive)setData(value);}).catch(e=>{if(alive)setError(e);});return()=>{alive=false;};},[...dependencies,version]);
  return {data,error,reload:()=>setVersion(v=>v+1),setData};
}
export function PageHead({eyebrow='YOUR WORKSPACE',title,description,children}) {return <header className="ws-page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description&&<p>{description}</p>}</div>{children}</header>;}
export function LoadState({resource,children,skeleton='panel',label='Loading your workspace data…'}) {if(resource.error)return <div className="ws-alert" role="alert">{resource.error.message}<div className="ws-actions" style={{marginTop:12}}><button className="btn btn--secondary" onClick={resource.reload}>Try again</button><Link to="/contact">Contact support</Link></div></div>;if(resource.data===null)return typeof skeleton==='string'?<PageSkeleton variant={skeleton} label={label}/>:skeleton;return typeof children==='function'?children(resource.data):children;}
export function Empty({title,description,to,label='Explore services',icon='layers'}){return <div className="ws-empty"><div className="ws-empty-icon"><Icon name={icon}/></div><h2>{title}</h2><p>{description}</p>{to&&<Link className="btn btn--secondary" to={to}>{label}</Link>}</div>;}
export const dateLabel = value => new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
