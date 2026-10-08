const lengths={waving:700,jumping:840,review:1030,error:1220};
export class PetMotion {
    trigger(name,now,animated,intensity){
        if(!animated||intensity===0||!lengths[name])return false;
        this.gesture={name,start:now,end:now+lengths[name]/(intensity===2?1.25:1)};return true;
    }
    pose(status,frame,now,animated,intensity){
        if(!animated){this.gesture=null;return {status,frame:0};}
        if(this.gesture&&now<this.gesture.end)return {status:this.gesture.name,frame:(now-this.gesture.start)/120*(intensity===2?1.25:1)};
        this.gesture=null;return {status,frame:frame*[0.75,1,1.25][intensity]};
    }
}
