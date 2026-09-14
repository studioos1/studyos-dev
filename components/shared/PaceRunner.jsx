// Study Pace mascot — runs faster and bounces higher as the score climbs, slower/lower as it
// drops. Ported from a standalone prototype (iterated live with Avishai until the gait actually
// read as running rather than swinging) — see Today.jsx for how `score` is computed and the
// .pr-* rules in globals.css for the animation rig itself.
//
// Two coordinate systems are in play here, worth knowing before touching either file: the leg/
// arm/knee rotations are nested CSS transforms on <g> elements INSIDE the <svg>, so they're
// specified in the SVG's own user-space units (the viewBox) — that math is entirely independent
// of how large the <svg> is actually rendered on the page. The overall hop (bounce), though, is a
// plain CSS transform on the <svg> element itself, which behaves like any other HTML box — that
// one IS in real screen pixels, so --bounce below is scaled to `size` rather than reused as a
// constant. If you resize this component, the legs/arms need no changes; only --bounce does.
//
// The character's own colors (jersey, shorts, skin, hair, sneakers) are fixed regardless of
// score, by design — only the bar it sits next to recolors. That was an explicit, repeated
// instruction while prototyping this.
export function PaceRunner({score=0,size=40}){
  const cycle=(1.65-(score/100)*1.1).toFixed(2)+"s";
  const bounce=(2+(score/100)*5.5).toFixed(1)+"px";
  const height=Math.round(size*1.5); // 72:108 viewBox aspect ratio (2:3)
  return(
    <svg className="pr-runner" width={size} height={height} viewBox="0 0 72 108" fill="none"
      style={{animationDuration:cycle,"--bounce":bounce,flexShrink:0}}>
      <g className="pr-legBack" style={{animationDuration:cycle}}>
        <path d="M36 62 L36 82" stroke="#3a4666" strokeWidth="9" strokeLinecap="round" fill="none"/>
        <g className="pr-shinBack" style={{animationDuration:cycle}}>
          <path d="M36 82 L36 101" stroke="#3a4666" strokeWidth="7" strokeLinecap="round" fill="none"/>
          <ellipse cx="36" cy="104" rx="7" ry="4.5" fill="#e8574a"/>
        </g>
      </g>
      <g className="pr-armBack" style={{animationDuration:cycle}}>
        <path d="M38 32 Q33 41 35 50" stroke="#f2b98c" strokeWidth="6.5" strokeLinecap="round" fill="none"/>
      </g>
      {/* torso (jersey) + shorts — fixed colors, drawn on top so the back limbs tuck behind it */}
      <path d="M25 52 Q36 58 47 52 L47 60 Q36 66 25 60 Z" fill="#2f3a56"/>
      <path d="M24 28 Q36 22 48 28 L47 56 Q36 62 25 56 Z" fill="#ff7a54"/>
      <path d="M24 28 Q36 22 48 28 L46 34 Q36 29 26 34 Z" fill="#ff9773"/>
      <g className="pr-legFront" style={{animationDuration:cycle}}>
        <path d="M36 62 L36 82" stroke="#3a4666" strokeWidth="9.5" strokeLinecap="round" fill="none"/>
        <g className="pr-shinFront" style={{animationDuration:cycle}}>
          <path d="M36 82 L36 101" stroke="#3a4666" strokeWidth="7.5" strokeLinecap="round" fill="none"/>
          <ellipse cx="36" cy="104" rx="7" ry="4.5" fill="#f2f6fc"/>
        </g>
      </g>
      <g className="pr-armFront" style={{animationDuration:cycle}}>
        <path d="M38 32 Q43 41 41 50" stroke="#f2b98c" strokeWidth="6.5" strokeLinecap="round" fill="none"/>
      </g>
      {/* head */}
      <circle cx="41" cy="15" r="11.5" fill="#f2b98c"/>
      <ellipse cx="37" cy="18" rx="2.6" ry="2" fill="#e8a878" opacity="0.5"/>
      <g className="pr-hair" style={{animationDuration:cycle,"--hair":(3+score/100*10)+"deg"}}>
        <path d="M29 13 Q32 1 45 3 Q54 5 52 14 Q46 6 37 7 Q31 8 29 13Z" fill="#4a3527"/>
      </g>
      {/* sunglasses */}
      <path d="M33 14.5 Q34 12.5 38 12.8 Q41 13 40.6 15.6 Q40.2 17.8 37 17.8 Q33.4 17.8 33 14.5Z" fill="#1a1f2b"/>
      <path d="M41.4 14 Q42 12 46 12.2 Q49.6 12.4 49 15.2 Q48.5 17.6 45 17.4 Q41.8 17.2 41.4 14Z" fill="#1a1f2b"/>
      <path d="M40.4 14.5 L41.6 14.2" stroke="#1a1f2b" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M33 13.6 L30.5 12.8 M49 13.6 L51.2 12.6" stroke="#1a1f2b" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M35 14.5 Q36 13.5 38 14" stroke="#5a6a8a" strokeWidth="0.8" opacity="0.6" fill="none"/>
      <ellipse cx="44.5" cy="21" rx="3" ry="2.4" fill="#c94b3f"/>
    </svg>
  );
}
