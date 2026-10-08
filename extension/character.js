import St from 'gi://St';
import Cairo from 'cairo';
import {petFrame} from './pet-model.js';

let petSurface=null;

// Vector companion: no images, external assets or separate windows.
export function createCharacter(size, atlasPath=null) {
    const actor = new St.DrawingArea({width:size, height:size, style_class:'ci-character'});
    if(atlasPath){
        try{petSurface??=Cairo.ImageSurface.createFromPNG(atlasPath);actor._petSurface=petSurface;}
        catch(e){console.warn(`Codex Island pet unavailable: ${e.message}`);}
    }
    actor.connect('repaint', () => {
        const cr = actor.get_context();
        const [w,h] = actor.get_surface_size();
        if(actor._petSurface){
            const {status='idle',frame=0,animated=false}=actor._face??{};
            const cell=petFrame(status,frame*120,animated);
            const scale=Math.min(w/192,h/208);
            cr.translate((w-192*scale)/2,(h-208*scale)/2);
            cr.scale(scale,scale);cr.rectangle(0,0,192,208);cr.clip();
            cr.setSourceSurface(actor._petSurface,-cell.column*192,-cell.row*208);cr.paint();cr.$dispose();return;
        }
        cr.scale(w/32, h/32);
        const {status='idle', frame=0, animated=false} = actor._face ?? {};
        const busy = ['working','thinking'].includes(status);
        const blink = animated && frame % 44 === 40;
        const shift = animated && busy ? Math.sin(frame/7)*1.4 : 0;
        const bob = animated && busy ? Math.sin(frame/5)*0.7 : 0;
        cr.translate(0, bob);
        cr.setSourceRGBA(...(status === 'error' ? [1,0.74,0.48,1] : status === 'finished' ? [0.64,0.92,0.72,1] : [0.94,0.94,0.97,1]));
        cr.moveTo(11,6); cr.curveTo(3,6,2,12,2,18);
        cr.curveTo(2,25,6,27,16,27); cr.curveTo(26,27,30,25,30,18);
        cr.curveTo(30,12,29,6,21,6); cr.closePath(); cr.fill();
        cr.setSourceRGBA(0.055,0.055,0.07,1);
        cr.setLineCap(Cairo.LineCap.ROUND); cr.setLineWidth(2.4);
        for (const x of [11,22]) {
            if (blink || status === 'finished') {
                cr.moveTo(x-1.3+shift,17);cr.lineTo(x+1.3+shift,17);cr.stroke();
            } else {
                cr.arc(x+shift,17,1.55,0,Math.PI*2);cr.fill();
            }
        }
        if (status === 'error') {cr.arc(16,22,1,0,Math.PI*2);cr.fill();}
        cr.$dispose();
    });
    return actor;
}

export function updateCharacter(actor, status, frame, animated) {
    actor._face = {status, frame, animated};
    actor.queue_repaint();
}
