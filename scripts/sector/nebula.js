/**
 * Живая туманность — порт WebGL-фона из map.html на PIXI.Mesh со своим шейдером.
 * Туманность лежит в координатах сцены (двигается вместе с картой), звёзды — точки
 * постоянного экранного размера, мерцают. Закрывает фон-картинку сцены.
 */

const VERT = `
precision highp float;
attribute vec2 aVertexPosition;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vWorld;
void main() {
  vWorld = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vWorld;
uniform float uT;      // время, с
uniform float uS;      // масштаб сцены (экранных px на px сцены)
uniform vec2 uCenter;  // станция, px сцены
uniform float uAlpha;

float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float nz(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<6;i++){v+=a*nz(p);p=m*p;a*=.5;}return v;}

// звёзды: сетка в px сцены, размер и яркость — в экранных px
vec3 stars(vec2 w, float cell, float dens, float seed){
  vec2 g=w/cell, id=floor(g), f=fract(g)-.5;
  float r=h21(id+seed); if(r>dens) return vec3(0.);
  vec2 o=(vec2(h21(id+seed+1.3),h21(id+seed+7.1))-.5)*.8;
  float d=length(f-o)*cell*uS;
  float sz=mix(.55,1.7,pow(h21(id+seed+3.7),3.));
  float tw=.65+.35*sin(uT*(.8+2.5*h21(id+9.))+h21(id)*6.28);
  float big=step(.93,h21(id+seed+2.2));
  float b=exp(-d*d/(sz*sz))*tw+big*.35*exp(-d/(sz*3.5))*tw;
  vec3 c=mix(vec3(.78,.88,1.),vec3(1.,.84,.68),h21(id+5.5));
  return c*b;
}

void main(){
  vec2 p=(vWorld-uCenter)/1200.; float t=uT*.010;
  vec2 q=vec2(fbm(p+vec2(0.,t)),fbm(p+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*1.3),fbm(p+3.*q+vec2(8.3,2.8)-t));
  float d=fbm(p+3.*r);
  float mask=smoothstep(.32,.8,fbm(p*.42+vec2(11.,3.)));
  float dens=pow(clamp((d-.3)*2.3,0.,1.),1.25)*mix(.22,1.,mask);
  float dust=smoothstep(.5,.74,fbm(p*2.4+r+vec2(40.,9.)));dens*=1.-dust*.72;
  vec3 deep=vec3(.08,.2,.58),vio=vec3(.42,.12,.55),teal=vec3(.04,.55,.62),pink=vec3(.72,.2,.45);
  vec3 col=mix(deep,vio,clamp(length(q)*.9-.25,0.,1.));
  col=mix(col,teal,smoothstep(.55,.8,d)*.55);col=mix(col,pink,smoothstep(.6,.8,r.x)*.35);
  float halo=fbm(p*.25+vec2(2.,7.));
  vec3 c=vec3(.010,.017,.04)+col*dens*1.15+deep*.10*smoothstep(.35,.7,halo)+vec3(.9,.95,1.)*pow(max(dens-.5,0.),2.)*1.6;
  c+=stars(vWorld,30.,.16,1.)*.5*(1.-dust*.6);
  c+=stars(vWorld,85.,.22,7.)*.95;
  c+=stars(vWorld,240.,.35,13.)*1.25;
  gl_FragColor=vec4(c*uAlpha,uAlpha);
}`;

/** Сетка-прямоугольник на всю сцену с шейдером туманности. */
export function createNebula(rect, center) {
  const { x, y, width: w, height: h } = rect;
  const geom = new PIXI.Geometry()
    .addAttribute("aVertexPosition", [x, y, x + w, y, x + w, y + h, x, y + h], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
  const shader = PIXI.Shader.from(VERT, FRAG, {
    uT: 0, uS: 1, uCenter: new Float32Array([center.x, center.y]), uAlpha: 1
  });
  const mesh = new PIXI.Mesh(geom, shader);
  mesh.name = "swmNebula";
  return mesh;
}

/** Проверить, что шейдер собирается на этой видеокарте. */
export function nebulaSupported() {
  try {
    const r = canvas.app.renderer;
    if (!r?.gl) return false;
    const prog = PIXI.Program.from(VERT, FRAG);
    const glProg = r.shader.generateProgram?.(new PIXI.Shader(prog, {}));
    if (glProg && !glProg.program) return false;
    return true;
  } catch (e) {
    console.warn("swm-core | живая туманность недоступна:", e);
    return false;
  }
}
