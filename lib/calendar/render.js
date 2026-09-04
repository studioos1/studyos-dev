// Pure rendering-support helpers shared by WeekGrid and Timeline — colors per activity type,
// and lane assignment for overlapping blocks. No dependency on data/time/planner.

export const TIMELINE_COLORS={
  class:    {line:"#e8a030",text:"#f5c060"}, // amber
  study:    {line:"#28a050",text:"#60d080"}, // green
  homework: {line:"#1ea8a0",text:"#5cd0c8"}, // cyan
  gym:      {line:"#8040c0",text:"#b090e0"}, // purple
  breakfast:{line:"#d8d8d8",text:"#f8f8f8"}, // white
  lunch:    {line:"#d8d8d8",text:"#f8f8f8"}, // white
  dinner:   {line:"#d8d8d8",text:"#f8f8f8"}, // white
  commute:  {line:"#484848",text:"#909090"},
  stretch:  {line:"#a070d0",text:"#c8a8ec"}, // light-purple, matches gym
  chore:    {line:"#2060c0",text:"#60a8f0"}, // blue
  fun:      {line:"#c04090",text:"#e090c0"}, // pink
  exam:     {line:"#c04020",text:"#f08060"},
  deadline: {line:"#c04020",text:"#f08060"},
  sleep:    {line:"#282838",text:"#505068"},
  default:  {line:"#4060a0",text:"#80a0d0"},
};
export function tc(type){return TIMELINE_COLORS[type]||TIMELINE_COLORS.default;}
// Assigns a vertical "lane" to each block so overlapping time ranges stack instead of drawing on top of each other,
// scoped per connected cluster of overlapping blocks — each block gets .lane (its column within its own cluster)
// and .clusterLanes (how many columns that cluster needs), so non-overlapping blocks elsewhere stay full-width.
export function assignLanesClustered(blocks){
  const sorted=[...blocks].sort((a,b)=>a.s-b.s);
  const result=[];
  let cluster=[],clusterEnd=-Infinity;
  function flush(){
    if(!cluster.length)return;
    const laneEnds=[];
    cluster.forEach(b=>{
      let lane=laneEnds.findIndex(e=>e<=b.s);
      if(lane===-1){lane=laneEnds.length;laneEnds.push(b.e);}
      else laneEnds[lane]=b.e;
      result.push({...b,lane,clusterLanes:0}); // clusterLanes filled in below once known
    });
    const clusterLanes=laneEnds.length;
    for(let i=result.length-cluster.length;i<result.length;i++)result[i].clusterLanes=clusterLanes;
    cluster=[];
  }
  sorted.forEach(b=>{
    if(cluster.length&&b.s>=clusterEnd){flush();clusterEnd=-Infinity;}
    cluster.push(b);
    clusterEnd=Math.max(clusterEnd,b.e);
  });
  flush();
  return result;
}
