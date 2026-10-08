const rows = {
    waving: {row:3,durations:[140,140,140,280]},
    jumping: {row:4,durations:[140,140,140,140,280]},
    review: {row:8,durations:[150,150,150,150,150,280]},
    idle: {row:0,durations:[280,110,110,140,140,320]},
    working: {row:7,durations:[120,120,120,120,120,220]},
    finished: {row:8,durations:[150,150,150,150,150,280]},
    error: {row:5,durations:[140,140,140,140,140,140,140,240]},
    stale: {row:6,durations:[150,150,150,150,150,260]},
};
export function petFrame(status,elapsed,animated) {
    const sequence=rows[status==='thinking'?'working':status]||rows.idle;
    let column=0;
    if(animated){
        let t=Math.max(0,elapsed)%sequence.durations.reduce((a,b)=>a+b,0);
        while(column<sequence.durations.length-1&&t>=sequence.durations[column])t-=sequence.durations[column++];
    }
    return {row:sequence.row,column};
}
