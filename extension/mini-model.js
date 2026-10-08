export class Conversation {
    constructor(){this.rows=[];this.turn=0;}
    load(messages){if(!this.rows.length)this.rows=messages.map((m,i)=>({...m,key:`history-${m.id||i}`})).slice(-32);}
    refresh(messages){const failed=this.rows.filter(r=>r.failed);this.rows=[...messages.map((m,i)=>({...m,key:`history-${m.id||i}`})),...failed].slice(-32);}
    begin(text){this.turn++;this.rows.push({key:`user-${this.turn}`,role:'Kamu',text});this.rows=this.rows.slice(-32);}
    receive(event){
        const key=`reply-${this.turn}-${event.itemId||'message'}`;
        let row=this.rows.find(r=>r.key===key);
        if(!row){row={key,role:'Codex',text:''};this.rows.push(row);}
        const text=event.event==='delta'?row.text+event.text:event.text;
        row.truncated=event.event==='delta'?(row.truncated||text.length>16000):(Boolean(event.truncated)||text.length>16000);
        row.text=text.slice(0,16000);
        this.rows=this.rows.slice(-32);
    }
    reject(){const row=this.rows.find(r=>r.key===`user-${this.turn}`);if(row)row.failed=true;}
}
export function chatRows(rows,pins,query=''){
    const q=query.trim().toLocaleLowerCase();
    const unique=[...new Map(rows.map(r=>[r.id,r])).values()];
    return unique.filter(r=>!q||`${r.title} ${r.project}`.toLocaleLowerCase().includes(q))
        .sort((a,b)=>Number(pins.includes(b.id))-Number(pins.includes(a.id)));
}
export function prependPage(older,newer){
    const seen=new Set();
    return [...older,...newer].filter(m=>{if(!m.id)return true;if(seen.has(m.id))return false;seen.add(m.id);return true;});
}

export class ChatSessions {
    constructor(){this.conversations=new Map();this.drafts=new Map();}
    get(id,active=null){
        const c=this.conversations.get(id)||new Conversation();this.conversations.delete(id);this.conversations.set(id,c);
        while(this.conversations.size>16){const victim=[...this.conversations.keys()].find(k=>k!=='mini'&&k!==active&&k!==id);if(!victim)break;this.conversations.delete(victim);}
        return c;
    }
    draft(id){return this.drafts.get(id)||'';}
    saveDraft(id,text){if(text)this.drafts.set(id,text);else this.drafts.delete(id);}
    acceptDraft(id,sent){if(this.draft(id)===sent)this.drafts.delete(id);}
}

export function shouldSubmit(enterToSend,shift,control){return !shift&&(enterToSend||control);}
